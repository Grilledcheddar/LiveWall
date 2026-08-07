import {
  AppWindow,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock3,
  ExternalLink,
  Focus,
  Grid2X2,
  Grip,
  GripVertical,
  ListVideo,
  Maximize2,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Replace,
  RotateCw,
  Square,
  TimerOff,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { type DragEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import GridLayout, { type Layout } from 'react-grid-layout';
import { Button } from '../components/Button';
import { SourceLibraryPanel } from '../components/SourceLibraryPanel';
import { P3WorkspacePanel } from '../components/P3WorkspacePanel';
import { useWall } from '../hooks/useWall';
import { normalizeSourceLibrary, saveLibrarySource, setLibraryFavorite } from '../lib/library';
import { canonicalSourceUrl, detectSource } from '../lib/sources';
import {
  defaultAppearance,
  moveTile,
  newTile,
  normalizeAppearance,
  normalizeOverlayMode,
  orderedTiles,
  reorderTile,
  replaceTileSource,
  playNextSource,
  recordSourceInState,
  selectActiveAudio,
} from '../lib/state';
import { fallbackTitle, finalizeTitle, resolveYouTubeTitle } from '../lib/titles';
import {
  defaultStartBehavior,
  formatTimestamp,
  normalizePlaybackStart,
  parseTimestamp,
  playbackKey,
} from '../lib/playback';
import type {
  PlaybackProgress,
  PlaybackStart,
  PlayerCommandName,
  PlayerHealth,
  Tile,
  VideoSource,
  WallAppearance,
  WallState,
} from '../lib/types';

function Countdown({ timestamp }: { timestamp: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.ceil((timestamp - now) / 1_000));
  return (
    <span className="countdown">
      <Clock3 size={13} /> {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

export interface SourceDialogResult {
  name: string;
  source: VideoSource;
  titleMode: 'auto' | 'manual';
  saveToLibrary: boolean;
  playback: PlaybackStart;
}

export function SourceDialog({
  kind,
  tile,
  onSubmit,
  onClose,
  returnFocus,
}: {
  kind: 'add' | 'edit' | 'replace' | 'save';
  tile?: Tile;
  onSubmit: (result: SourceDialogResult) => Promise<void>;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
}) {
  const initialName = tile?.name ?? '';
  const initialUrl = kind === 'edit' || kind === 'save' ? (tile?.source.url ?? '') : '';
  const initialTitleMode = tile?.titleMode ?? 'manual';
  const initialPlayback =
    tile?.playback ?? (tile ? defaultStartBehavior(tile.source) : { behavior: 'resume' as const });
  const [name, setName] = useState(initialName);
  const [url, setUrl] = useState(initialUrl);
  const [titleMode, setTitleMode] = useState<'auto' | 'manual'>(initialTitleMode);
  const [saveToLibrary, setSaveToLibrary] = useState(kind === 'save');
  const [startBehavior, setStartBehavior] = useState(initialPlayback.behavior);
  const [specificTime, setSpecificTime] = useState(
    initialPlayback.specificTime === undefined ? '' : formatTimestamp(initialPlayback.specificTime),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [titleLoading, setTitleLoading] = useState(false);
  const modeTouched = useRef(false);
  const lookupTimer = useRef<number | undefined>(undefined);
  const heading =
    kind === 'add'
      ? 'Add source'
      : kind === 'replace'
        ? 'Replace Now'
        : kind === 'save'
          ? 'Save Source'
          : 'Edit tile';
  const dirty =
    name !== initialName ||
    url !== initialUrl ||
    titleMode !== initialTitleMode ||
    (kind !== 'save' && saveToLibrary) ||
    startBehavior !== initialPlayback.behavior ||
    specificTime !==
      (initialPlayback.specificTime === undefined
        ? ''
        : formatTimestamp(initialPlayback.specificTime));
  function requestClose() {
    if (dirty && !confirm('Discard your unsaved changes?')) return;
    onClose();
  }

  function sourceFor(value = url) {
    try {
      return detectSource(value);
    } catch {
      return undefined;
    }
  }

  async function lookupTitle(value = url) {
    const source = sourceFor(value);
    if (source?.type !== 'youtube') return;
    setTitleLoading(true);
    setError('');
    try {
      setName(await resolveYouTubeTitle(source.url));
    } catch (reason) {
      setName((current) => current || 'YouTube video');
      setError(
        reason instanceof Error
          ? reason.message
          : 'Automatic title unavailable. You can still use this source.',
      );
    } finally {
      setTitleLoading(false);
    }
  }

  function updateUrl(value: string) {
    setUrl(value);
    setError('');
    clearTimeout(lookupTimer.current);
    const source = sourceFor(value);
    if (source?.type === 'youtube' && !modeTouched.current) {
      setTitleMode('auto');
      setTitleLoading(true);
      lookupTimer.current = window.setTimeout(() => void lookupTitle(value), 350);
    } else if (source && source.type !== 'youtube' && !name) {
      setTitleMode('manual');
      setName(fallbackTitle(source));
    }
  }

  useEffect(() => () => clearTimeout(lookupTimer.current), []);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => returnFocus?.focus(), 0);
    };
  }, [returnFocus]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (dirty && !confirm('Discard your unsaved changes?')) return;
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [dirty, onClose]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const source = kind === 'edit' || kind === 'save' ? tile!.source : detectSource(url);
      setBusy(true);
      const finalName = await finalizeTitle(source, titleMode, name);
      const parsedSpecific =
        startBehavior === 'specific' ? parseTimestamp(specificTime) : undefined;
      if (startBehavior === 'specific' && parsedSpecific === undefined)
        throw new Error('Enter a start time in seconds or a value such as 1:25:30.');
      await onSubmit({
        name: finalName,
        source,
        titleMode,
        saveToLibrary,
        playback: normalizePlaybackStart(
          { behavior: startBehavior, specificTime: parsedSpecific },
          source,
        ),
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'That source could not be saved.');
    } finally {
      setBusy(false);
    }
  }

  const proposed = sourceFor();
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      data-testid="source-dialog-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && requestClose()}
    >
      <form
        className="source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-dialog-title"
        onSubmit={submit}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">SOURCE SETUP</span>
            <h2 id="source-dialog-title">{heading}</h2>
          </div>
          <Button
            variant="ghost"
            type="button"
            className="icon-button dialog-close"
            onClick={requestClose}
            aria-label="Close Save Source dialog"
            title="Close dialog"
          >
            <X />
          </Button>
        </div>
        <div className="dialog-body">
          {kind === 'replace' && tile && (
            <div className="replacement-comparison">
              <span>EXISTING SOURCE</span>
              <strong>{tile.source.url}</strong>
            </div>
          )}
          {kind !== 'edit' && kind !== 'save' && (
            <label>
              {kind === 'replace' ? 'Replacement URL' : 'Source URL'}
              <input
                autoFocus
                value={url}
                onChange={(event) => updateUrl(event.target.value)}
                placeholder="https://youtube.com/watch?v=…"
                inputMode="url"
              />
            </label>
          )}
          {kind === 'save' && tile && (
            <div className="replacement-comparison proposed">
              <span>CURRENT SOURCE</span>
              <strong>{tile.source.url}</strong>
            </div>
          )}
          {kind === 'replace' && proposed && (
            <div className="replacement-comparison proposed">
              <span>PROPOSED REPLACEMENT</span>
              <strong>
                {proposed.type.toUpperCase()} · {proposed.url}
              </strong>
            </div>
          )}
          <fieldset className="title-mode">
            <legend>Title</legend>
            <label>
              <input
                type="radio"
                name="title-mode"
                checked={titleMode === 'auto'}
                disabled={proposed?.type !== 'youtube'}
                onChange={() => {
                  modeTouched.current = true;
                  setTitleMode('auto');
                  void lookupTitle();
                }}
              />
              Automatic title
            </label>
            <label>
              <input
                type="radio"
                name="title-mode"
                checked={titleMode === 'manual'}
                onChange={() => {
                  modeTouched.current = true;
                  setTitleMode('manual');
                }}
              />
              Manual title
            </label>
          </fieldset>
          <label>
            Tile title
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (titleMode === 'auto') {
                  modeTouched.current = true;
                  setTitleMode('manual');
                }
              }}
              placeholder="Main stage"
              maxLength={160}
            />
          </label>
          {titleLoading && (
            <p className="title-loading">
              <RefreshCw className="spin" size={14} /> Loading YouTube title…
            </p>
          )}
          {titleMode === 'auto' && proposed?.type === 'youtube' && !titleLoading && (
            <Button
              variant="secondary"
              type="button"
              className="refresh-title"
              onClick={() => void lookupTitle()}
            >
              <RefreshCw size={14} /> Refresh title
            </Button>
          )}
          <p className="helper">
            Automatic YouTube titles are looked up once. You can always type a manual title instead.
          </p>
          <fieldset className="start-behavior">
            <legend>Start behavior</legend>
            <label>
              Behavior
              <select
                value={startBehavior}
                onChange={(event) =>
                  setStartBehavior(event.target.value as PlaybackStart['behavior'])
                }
              >
                <option value="live">Live edge</option>
                <option value="resume">Resume where I stopped</option>
                <option value="specific">Start at a specific time</option>
                <option value="beginning">Start from beginning</option>
              </select>
            </label>
            {startBehavior === 'specific' && (
              <label>
                Specific time
                <input
                  aria-label="Specific start time"
                  value={specificTime}
                  onChange={(event) => setSpecificTime(event.target.value)}
                  placeholder="1:25:30 or seconds"
                />
              </label>
            )}
            {proposed?.type === 'website' && (
              <small>Playback restoration is unavailable for generic website embeds.</small>
            )}
          </fieldset>
          {error && <p className="form-error">{error}</p>}
          {kind !== 'save' && (
            <label className="save-library-option">
              <input
                type="checkbox"
                checked={saveToLibrary}
                onChange={(event) => setSaveToLibrary(event.target.checked)}
              />
              <span>
                <strong>Save to Library</strong>
                <small>Keep this source for reuse. Recents are still recorded automatically.</small>
              </span>
            </label>
          )}
        </div>
        <div className="dialog-actions">
          <Button variant="secondary" type="button" onClick={requestClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || titleLoading}>
            {busy ? 'Saving…' : kind === 'replace' ? 'Confirm replacement' : heading}
          </Button>
        </div>
      </form>
    </div>
  );
}

function TileCard({
  tile,
  isActiveAudio,
  onSave,
  onDelete,
  onCommand,
  onEdit,
  onReplace,
  onRefreshTitle,
  health,
  onRetry,
  onFocus,
  onMoveUp,
  onMoveDown,
  moveUpDisabled,
  moveDownDisabled,
  onDragStart,
  onQueue,
  onPlayNext,
  libraryEntry,
  onSaveToLibrary,
  onToggleFavorite,
  progress,
  onClearPosition,
}: {
  tile: Tile;
  isActiveAudio: boolean;
  onSave: (update: (tile: Tile) => Tile) => Promise<unknown>;
  onDelete: () => void;
  onCommand: (command: PlayerCommandName, value?: number) => void;
  onEdit: () => void;
  onReplace: () => void;
  onRefreshTitle: () => void;
  health?: PlayerHealth;
  onRetry: () => void;
  onFocus: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  moveUpDisabled: boolean;
  moveDownDisabled: boolean;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onQueue: (source: VideoSource, playback: PlaybackStart) => Promise<unknown>;
  onPlayNext: () => Promise<unknown>;
  libraryEntry?: import('../lib/types').LibrarySource;
  onSaveToLibrary: (trigger: HTMLElement) => void;
  onToggleFavorite: () => Promise<unknown>;
  progress?: PlaybackProgress;
  onClearPosition: () => Promise<unknown>;
}) {
  const [queueUrl, setQueueUrl] = useState('');
  const [delay, setDelay] = useState(60);
  const [seek, setSeek] = useState(0);
  const [volumeDraft, setVolumeDraft] = useState(tile.volume);
  const [queueBehavior, setQueueBehavior] = useState<PlaybackStart['behavior']>('resume');
  const [queueSpecificTime, setQueueSpecificTime] = useState('');
  const volumeTimer = useRef<number | undefined>(undefined);
  const latestVolume = useRef(tile.volume);
  const controllable = tile.source.type !== 'website';

  useEffect(() => {
    if (!volumeTimer.current) {
      setVolumeDraft(tile.volume);
      latestVolume.current = tile.volume;
    }
  }, [tile.volume]);
  useEffect(() => () => clearTimeout(volumeTimer.current), []);

  function persistVolume() {
    clearTimeout(volumeTimer.current);
    volumeTimer.current = undefined;
    const value = latestVolume.current;
    void onSave((current) => ({ ...current, volume: value }));
  }

  function changeVolume(value: number) {
    latestVolume.current = value;
    setVolumeDraft(value);
    onCommand('volume', value);
    clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(persistVolume, 250);
  }

  async function queue() {
    try {
      const source = detectSource(queueUrl);
      const specificTime =
        queueBehavior === 'specific' ? parseTimestamp(queueSpecificTime) : undefined;
      if (queueBehavior === 'specific' && specificTime === undefined)
        throw new Error('Enter a valid queued start time.');
      await onQueue(
        source,
        normalizePlaybackStart({ behavior: queueBehavior, specificTime }, source),
      );
      setQueueUrl('');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Invalid source URL.');
    }
  }

  return (
    <article className="admin-tile-card" data-testid="admin-tile" data-tile-id={tile.id}>
      <header>
        <Button
          variant="ghost"
          className="reorder-handle"
          draggable
          onDragStart={onDragStart}
          aria-label={`Drag ${tile.name} to reorder`}
          title="Drag to reorder"
        >
          <GripVertical />
        </Button>
        <div className="tile-number">{tile.name.slice(0, 2).toUpperCase()}</div>
        <div className="tile-title">
          <h3>{tile.name}</h3>
          <span>
            <i className="status-dot" /> {tile.source.type.toUpperCase()} ·{' '}
            {isActiveAudio ? 'Active audio' : 'Muted mix'}
          </span>
        </div>
        <Button variant="ghost" className="icon-button subtle" onClick={onEdit} title="Edit tile">
          <MoreHorizontal />
        </Button>
      </header>
      <div className={`health-strip health-${health?.status ?? 'unknown'}`}>
        <span>
          <i className="status-dot" /> {health?.status ?? 'unknown'}
        </span>
        <small>{health?.message ?? 'Waiting for a status report from the Wall.'}</small>
        {health?.lastReadyAt && (
          <time>Ready {new Date(health.lastReadyAt).toLocaleTimeString()}</time>
        )}
        {health?.retryAttempt ? <time>Retry {health.retryAttempt}/3</time> : null}
        {health?.technicalDetail && (
          <details>
            <summary>Details</summary>
            <code>{health.technicalDetail}</code>
          </details>
        )}
        <Button variant="secondary" onClick={onRetry}>
          <RotateCw size={13} /> Retry now
        </Button>
      </div>
      <div className="source-strip">
        <div>
          <span>NOW PLAYING</span>
          <strong>{tile.source.youtubeId || new URL(tile.source.url).hostname}</strong>
          <small>{tile.source.url}</small>
        </div>
        <a href={tile.source.url} target="_blank" rel="noreferrer" title="Open source">
          <ExternalLink size={15} />
        </a>
      </div>
      <div className="transport">
        <Button variant="secondary" disabled={!controllable} onClick={() => onCommand('play')}>
          <Play size={16} /> Play
        </Button>
        <Button variant="secondary" disabled={!controllable} onClick={() => onCommand('pause')}>
          <Pause size={16} /> Pause
        </Button>
        <Button variant="primary" className="replace-now" onClick={onReplace}>
          <Replace size={16} /> Replace Now
        </Button>
        <Button variant="secondary" disabled={!controllable} onClick={() => onCommand('restart')}>
          <RotateCw size={16} /> Restart
        </Button>
        {health?.isLive && (
          <Button variant="primary" className="go-live" onClick={() => onCommand('go-live')}>
            <Radio size={15} /> Go Live
          </Button>
        )}
        {tile.source.type === 'youtube-playlist' && (
          <>
            <Button variant="secondary" onClick={() => onCommand('previous')}>
              Previous Video
            </Button>
            <Button variant="secondary" onClick={() => onCommand('next')}>
              Next Video
            </Button>
          </>
        )}
        <label className="seek-control">
          Seek
          <input
            type="number"
            min="0"
            value={seek}
            onChange={(event) => setSeek(Number(event.target.value))}
          />
          <Button
            variant="secondary"
            disabled={!controllable}
            onClick={() => onCommand('seek', seek)}
          >
            Go
          </Button>
        </label>
      </div>
      <div className="playback-settings">
        <label>
          Start behavior
          <select
            value={tile.playback?.behavior ?? defaultStartBehavior(tile.source).behavior}
            onChange={(event) =>
              void onSave((current) => ({
                ...current,
                playback: normalizePlaybackStart(
                  {
                    behavior: event.target.value,
                    specificTime: current.playback?.specificTime,
                  },
                  current.source,
                ),
              }))
            }
          >
            <option value="live">Live edge</option>
            <option value="resume">Resume where I stopped</option>
            <option value="specific">Specific time</option>
            <option value="beginning">Beginning</option>
          </select>
        </label>
        <span>
          {health?.isLive
            ? health.atLiveEdge
              ? 'LIVE'
              : 'Behind live'
            : progress
              ? `Saved at ${formatTimestamp(progress.position)}`
              : 'No saved position'}
        </span>
        <Button variant="secondary" disabled={!progress} onClick={() => void onClearPosition()}>
          Clear Saved Position
        </Button>
        <small>Changes apply the next time you restart or reload this source.</small>
      </div>
      {tile.source.type === 'youtube-playlist' && (
        <div className="playlist-status">
          <strong>
            Playlist{' '}
            {typeof health?.playlistIndex === 'number'
              ? health.playlistIndex + 1
              : tile.playlistIndex !== undefined
                ? tile.playlistIndex + 1
                : 1}
            {health?.playlistLength ? ` of ${health.playlistLength}` : ''}
          </strong>
          {health?.currentTitle && <span>{health.currentTitle}</span>}
          {health?.upNextTitle && <small>Up next: {health.upNextTitle}</small>}
          {health?.warning && <p role="alert">{health.warning}</p>}
        </div>
      )}
      <div className="audio-row">
        <Button
          variant={isActiveAudio ? 'primary' : 'secondary'}
          className={isActiveAudio ? 'audio-active' : ''}
          disabled={!controllable}
          onClick={() => onCommand(tile.muted ? 'unmute' : 'mute')}
        >
          {tile.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
          {health?.audioActivationRequired
            ? 'Wall audio needs activation'
            : isActiveAudio
              ? 'Active audio'
              : tile.muted
                ? 'Muted'
                : 'Audible'}
        </Button>
        <input
          aria-label={`Volume for ${tile.name}`}
          disabled={!controllable}
          type="range"
          min="0"
          max="100"
          value={volumeDraft}
          onChange={(event) => changeVolume(Number(event.target.value))}
          onPointerUp={persistVolume}
          onKeyUp={persistVolume}
        />
        <output>{volumeDraft}</output>
      </div>
      <div className="queue-panel">
        <div className="section-label">
          <ListVideo size={14} /> UP NEXT
        </div>
        {tile.queuedSource ? (
          <div className="queued-source">
            <div>
              <strong>{tile.queuedSource.type.toUpperCase()}</strong>
              <small>{tile.queuedSource.url}</small>
            </div>
            {tile.scheduledAt && <Countdown timestamp={tile.scheduledAt} />}
          </div>
        ) : (
          <p className="empty-queue">No source queued</p>
        )}
        <div className="queue-input">
          <input
            aria-label={`Queue URL for ${tile.name}`}
            value={queueUrl}
            onChange={(event) => setQueueUrl(event.target.value)}
            placeholder="Paste next source URL"
          />
          <Button
            variant="secondary"
            onClick={queue}
            disabled={!queueUrl}
            title={!queueUrl ? 'Paste a source URL before queueing.' : 'Queue this source'}
          >
            Queue
          </Button>
        </div>
        <div className="queued-playback-settings">
          <label>
            Queued start
            <select
              value={queueBehavior}
              onChange={(event) =>
                setQueueBehavior(event.target.value as PlaybackStart['behavior'])
              }
            >
              <option value="live">Live edge</option>
              <option value="resume">Resume</option>
              <option value="specific">Specific time</option>
              <option value="beginning">Beginning</option>
            </select>
          </label>
          {queueBehavior === 'specific' && (
            <input
              aria-label={`Queued start time for ${tile.name}`}
              value={queueSpecificTime}
              onChange={(event) => setQueueSpecificTime(event.target.value)}
              placeholder="1:25:30"
            />
          )}
        </div>
        {tile.queuedSource && (
          <div className="queue-actions">
            <Button variant="primary" className="play-next" onClick={() => void onPlayNext()}>
              <ChevronRight size={16} /> Play Next
            </Button>
            <label>
              <input
                type="number"
                min="1"
                max="86400"
                value={delay}
                onChange={(event) => setDelay(Number(event.target.value))}
              />{' '}
              sec
            </label>
            <Button
              variant="secondary"
              onClick={() =>
                onSave((current) => ({ ...current, scheduledAt: Date.now() + delay * 1_000 }))
              }
            >
              <Clock3 size={15} /> Schedule
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                onSave((current) => ({
                  ...current,
                  queuedSource: undefined,
                  scheduledAt: undefined,
                }))
              }
            >
              <TimerOff size={15} /> Cancel
            </Button>
          </div>
        )}
      </div>
      <footer>
        <Button variant="secondary" onClick={onFocus}>
          <Focus size={15} /> Focus
        </Button>
        <Button
          variant="ghost"
          onClick={onMoveUp}
          disabled={moveUpDisabled}
          aria-label={`Move ${tile.name} up`}
        >
          <ArrowUp size={15} /> Up
        </Button>
        <Button
          variant="ghost"
          onClick={onMoveDown}
          disabled={moveDownDisabled}
          aria-label={`Move ${tile.name} down`}
        >
          <ArrowDown size={15} /> Down
        </Button>
        {tile.titleMode === 'auto' && tile.source.type === 'youtube' && (
          <Button variant="secondary" onClick={onRefreshTitle}>
            <RefreshCw size={15} /> Refresh title
          </Button>
        )}
        <Button variant="secondary" onClick={onEdit}>
          <Pencil size={15} /> Edit title
        </Button>
        <Button
          variant="secondary"
          onClick={(event) => onSaveToLibrary(event.currentTarget)}
          disabled={libraryEntry?.saved}
          title={
            libraryEntry?.saved
              ? 'This source is already saved in the Source Library.'
              : 'Save this active source for reuse.'
          }
        >
          {libraryEntry?.saved ? 'Saved to Library' : 'Save to Library'}
        </Button>
        <Button
          variant="ghost"
          onClick={() => void onToggleFavorite()}
          disabled={!libraryEntry?.saved}
          aria-label={
            libraryEntry?.favorite
              ? `Remove ${tile.name} from favorites`
              : `Add ${tile.name} to favorites`
          }
          title={
            libraryEntry?.saved
              ? libraryEntry.favorite
                ? 'Remove from favorites'
                : 'Add this saved source to favorites'
              : 'Save to Library before adding this source to favorites.'
          }
        >
          {libraryEntry?.favorite ? '★ Favorited' : '☆ Add to favorites'}
        </Button>
        <Button variant="destructive" className="danger-link" onClick={onDelete}>
          <Trash2 size={15} /> Delete
        </Button>
      </footer>
    </article>
  );
}

type DialogState = { returnFocus?: HTMLElement | null } & (
  | { mode: 'add' }
  | { mode: 'edit'; tile: Tile }
  | { mode: 'replace'; tile: Tile }
  | { mode: 'save'; tile: Tile }
);

export function AdminPage() {
  const {
    state,
    save,
    saveLibrary,
    importLibrary,
    connected,
    command,
    healthByTile,
    progress,
    templates,
    presets,
    saveTemplates,
    savePresets,
    clearPlaybackProgress,
    stateError,
  } = useWall();
  const [dialog, setDialog] = useState<DialogState>();
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [draggedTileId, setDraggedTileId] = useState<string>();
  const [globalMessage, setGlobalMessage] = useState('');
  const [wallSessionStatus, setWallSessionStatus] = useState('checking');
  const tiles = useMemo(() => orderedTiles(state.tiles), [state.tiles]);
  const appearance = normalizeAppearance(state.appearance);
  const overlayMode = normalizeOverlayMode(state.overlayMode);
  const patchState = (change: (state: WallState) => WallState) =>
    save((current) => change(current));
  const patchTile = (id: string, change: (tile: Tile) => Tile) =>
    patchState((current) => ({
      ...current,
      tiles: current.tiles.map((tile) => (tile.id === id ? change(tile) : tile)),
    }));

  function openDialog(next: DialogState, trigger?: HTMLElement | null) {
    setDialog({
      ...next,
      returnFocus: trigger ?? (document.activeElement as HTMLElement | null),
    });
  }

  useEffect(() => {
    if (!globalMessage) return;
    const timer = window.setTimeout(() => setGlobalMessage(''), 5_000);
    return () => clearTimeout(timer);
  }, [globalMessage]);

  async function toggleFavorite(tile: Tile) {
    const canonical = canonicalSourceUrl(tile.source);
    const entry = normalizeSourceLibrary(state.library).entries.find(
      (candidate) => candidate.canonicalUrl === canonical,
    );
    if (!entry?.saved) {
      setGlobalMessage('Save this source to the Source Library before adding it to favorites.');
      return;
    }
    const favorite = !entry.favorite;
    await saveLibrary(setLibraryFavorite(state.library, entry.id, favorite));
    setGlobalMessage(
      favorite
        ? `Added ‘${entry.title}’ to favorites.`
        : `Removed ‘${entry.title}’ from favorites.`,
    );
  }

  useEffect(() => {
    let active = true;
    const refresh = () =>
      fetch('/api/wall-session')
        .then((response) => response.json())
        .then(
          (result) => active && setWallSessionStatus(result.Status === 'open' ? 'open' : 'closed'),
        )
        .catch(() => active && setWallSessionStatus('unavailable'));
    void refresh();
    const timer = window.setInterval(refresh, 3_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  async function controlDedicatedWall(action: 'close' | 'open') {
    if (
      action === 'close' &&
      !confirm(
        'Close the dedicated LiveWall display on Monitor 2? Your wall configuration will remain saved.',
      )
    )
      return;
    try {
      const response = await fetch(`/api/wall-session/${action}`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.Message || 'The Wall action was rejected.');
      setWallSessionStatus(action === 'close' ? 'closed' : 'open');
      setGlobalMessage(result.Message);
    } catch (error) {
      setGlobalMessage(error instanceof Error ? error.message : 'The Wall action failed safely.');
    }
  }

  async function setAudio(id: string) {
    await patchState((current) => selectActiveAudio(current, id));
    state.tiles.forEach((tile) => void command(tile.id, tile.id === id ? 'unmute' : 'mute'));
  }

  function deleteTile(tile: Tile) {
    if (!confirm(`Delete “${tile.name}”? Its queue and timer will also be removed.`)) return;
    void patchState((current) => ({
      ...current,
      activeAudioTileId:
        current.activeAudioTileId === tile.id ? undefined : current.activeAudioTileId,
      focusedTileId: current.focusedTileId === tile.id ? undefined : current.focusedTileId,
      tiles: current.tiles.filter((item) => item.id !== tile.id),
    }));
  }

  function saveLayout(layout: Layout[]) {
    void patchState((current) => ({
      ...current,
      tiles: current.tiles.map((tile) => {
        const item = layout.find((entry) => entry.i === tile.id);
        return item ? { ...tile, x: item.x, y: item.y, w: item.w, h: item.h } : tile;
      }),
    }));
  }

  async function refreshTitle(tile: Tile) {
    try {
      const name = await resolveYouTubeTitle(tile.source.url);
      await patchTile(tile.id, (current) => ({ ...current, name, titleMode: 'auto' }));
    } catch {
      alert('The YouTube title is temporarily unavailable. The current title was kept.');
    }
  }

  async function runGlobal(name: 'play' | 'pause') {
    await command('*', name);
    setGlobalMessage(`${name === 'play' ? 'Play' : 'Pause'} sent to all controllable players.`);
  }

  async function muteAll() {
    await patchState((current) => ({
      ...selectActiveAudio(current, undefined),
      tiles: current.tiles.map((tile) => ({ ...tile, muted: true })),
    }));
    await command('*', 'mute');
    setGlobalMessage('All players are muted; saved volume levels were preserved.');
  }

  async function stopAll() {
    if (
      !confirm(
        'Stop All unloads every player. Saved sources, queues, layout, and volume settings are kept. Continue?',
      )
    )
      return;
    await command('*', 'stop');
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    await patchState((current) => ({ ...current, globallyStopped: true }));
    setGlobalMessage('All players are stopped and unloaded.');
  }

  async function resumeAll() {
    await patchState((current) => ({ ...current, globallyStopped: false }));
    await command('*', 'resume');
    setGlobalMessage('Players are reconnecting at saved positions or the live edge.');
  }

  function updateAppearance(change: Partial<WallAppearance>) {
    void patchState((current) => ({
      ...current,
      appearance: { ...normalizeAppearance(current.appearance), ...change },
    }));
  }

  return (
    <main className="admin-shell">
      <aside className="sidebar">
        <a href="/admin" className="brand">
          <span>
            <Radio />
          </span>
          <strong>LiveWall</strong>
        </a>
        <nav>
          <a className="active" href="/admin">
            <AppWindow /> Control room
          </a>
          <a href="/wall" target="_blank">
            <MonitorPlay /> Open wall
          </a>
        </nav>
        <div className="sidebar-status">
          <span className={connected ? 'connected' : ''} />
          <div>
            <strong>{connected ? 'Wall connected' : 'Reconnecting'}</strong>
            <small>{connected ? 'Changes are live' : 'Your work remains saved'}</small>
          </div>
        </div>
      </aside>
      <section className="admin-main">
        {stateError && (
          <div className="state-error" role="alert">
            {stateError}
          </div>
        )}
        {globalMessage && (
          <div className="feedback-banner" role="status">
            <span>{globalMessage}</span>
            <Button
              variant="ghost"
              type="button"
              className="icon-button"
              aria-label="Dismiss notification"
              title="Dismiss notification"
              onClick={() => setGlobalMessage('')}
            >
              <X size={16} />
            </Button>
          </div>
        )}
        <header className="topbar">
          <div>
            <span className="eyebrow">CONTROL ROOM</span>
            <h1>Video sources</h1>
            <p>Manage what is playing without interrupting the wall.</p>
          </div>
          <div className="top-actions">
            <div className="open-wall-group">
              {wallSessionStatus === 'open' ? (
                <Button
                  variant="secondary"
                  className="close-wall"
                  onClick={() => void controlDedicatedWall('close')}
                >
                  <X size={16} /> Close Wall
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  disabled={wallSessionStatus === 'checking'}
                  onClick={() => void controlDedicatedWall('open')}
                >
                  <Maximize2 size={16} /> Open Wall
                </Button>
              )}
              <a href="/wall" target="_blank">
                Open normal Wall
              </a>
              <small>
                {wallSessionStatus === 'open'
                  ? 'Dedicated kiosk is running.'
                  : 'Reopen on Monitor 2 in kiosk mode.'}
              </small>
            </div>
            <Button
              variant="primary"
              disabled={state.tiles.length >= 9}
              onClick={(event) => openDialog({ mode: 'add' }, event.currentTarget)}
            >
              <Plus size={17} /> Add Source
            </Button>
          </div>
        </header>
        <div className="summary-bar">
          <div>
            <strong>{state.tiles.length}</strong>
            <span>ACTIVE TILES</span>
          </div>
          <div>
            <strong>{state.tiles.filter((tile) => tile.queuedSource).length}</strong>
            <span>QUEUED</span>
          </div>
          <div>
            <strong>{state.tiles.filter((tile) => tile.scheduledAt).length}</strong>
            <span>SCHEDULED</span>
          </div>
          <div className="layout-switch">
            <span>LAYOUT</span>
            <Button
              variant="ghost"
              className={state.layoutMode === 'automatic' ? 'selected' : ''}
              aria-pressed={state.layoutMode === 'automatic'}
              onClick={() =>
                void patchState((current) => ({ ...current, layoutMode: 'automatic' }))
              }
            >
              <Grid2X2 size={15} /> Auto
            </Button>
            <Button
              variant="ghost"
              className={state.layoutMode === 'freeform' ? 'selected' : ''}
              aria-pressed={state.layoutMode === 'freeform'}
              onClick={() => {
                void patchState((current) => ({ ...current, layoutMode: 'freeform' }));
                setLayoutEditing(true);
              }}
            >
              <Grip size={15} /> Freeform
            </Button>
          </div>
        </div>
        <section className="p1-control-panel" aria-label="Wall controls">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">GLOBAL CONTROL</span>
              <h2>Entire wall</h2>
            </div>
            <span className={state.globallyStopped ? 'wall-stopped' : 'wall-running'}>
              {state.globallyStopped ? 'Stopped' : 'Running'}
            </span>
          </div>
          <div className="global-actions">
            <Button
              variant="secondary"
              onClick={() => void runGlobal('play')}
              disabled={state.globallyStopped}
            >
              <Play size={16} /> Play All
            </Button>
            <Button
              variant="secondary"
              onClick={() => void runGlobal('pause')}
              disabled={state.globallyStopped}
            >
              <Pause size={16} /> Pause All
            </Button>
            <Button variant="secondary" onClick={() => void muteAll()}>
              <VolumeX size={16} /> Mute All
            </Button>
            {!state.globallyStopped ? (
              <Button
                variant="destructive"
                className="danger-control"
                onClick={() => void stopAll()}
              >
                <Square size={15} /> Stop All
              </Button>
            ) : (
              <Button variant="primary" className="resume-control" onClick={() => void resumeAll()}>
                <Play size={16} /> Resume All
              </Button>
            )}
            {state.focusedTileId && (
              <Button
                variant="secondary"
                onClick={() =>
                  void patchState((current) => ({ ...current, focusedTileId: undefined }))
                }
              >
                <X size={16} /> Exit Focus
              </Button>
            )}
          </div>
        </section>
        {Object.values(healthByTile).some((health) => health.status === 'failed') && (
          <div className="health-notice" role="alert">
            One or more sources exhausted automatic retries. Healthy tiles remain unaffected; use
            Retry now on the affected card.
          </div>
        )}
        <section className="appearance-panel" aria-label="Wall appearance">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">DISPLAY</span>
              <h2>Wall appearance</h2>
            </div>
          </div>
          <div className="preset-actions">
            <Button
              variant="ghost"
              onClick={() => updateAppearance({ gap: 0, borderVisible: false, cornerRadius: 0 })}
            >
              Seamless
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                updateAppearance({ gap: 4, borderVisible: true, borderWidth: 1, cornerRadius: 4 })
              }
            >
              Subtle
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                updateAppearance({ gap: 12, borderVisible: true, borderWidth: 2, cornerRadius: 10 })
              }
            >
              Framed
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void patchState((current) => ({ ...current, appearance: defaultAppearance() }))
              }
            >
              Reset
            </Button>
          </div>
          <div className="appearance-fields">
            <label>
              Background{' '}
              <input
                type="color"
                value={appearance.backgroundColor}
                onChange={(event) => updateAppearance({ backgroundColor: event.target.value })}
              />
            </label>
            <label>
              Gap{' '}
              <input
                type="range"
                min="0"
                max="32"
                value={appearance.gap}
                onChange={(event) => updateAppearance({ gap: Number(event.target.value) })}
              />
              <output>{appearance.gap}px</output>
            </label>
            <label>
              <input
                type="checkbox"
                checked={appearance.borderVisible}
                onChange={(event) => updateAppearance({ borderVisible: event.target.checked })}
              />{' '}
              Border
            </label>
            <label>
              Border color{' '}
              <input
                type="color"
                value={appearance.borderColor}
                onChange={(event) => updateAppearance({ borderColor: event.target.value })}
              />
            </label>
            <label>
              Width{' '}
              <input
                type="range"
                min="0"
                max="8"
                value={appearance.borderWidth}
                onChange={(event) => updateAppearance({ borderWidth: Number(event.target.value) })}
              />
              <output>{appearance.borderWidth}px</output>
            </label>
            <label>
              Radius{' '}
              <input
                type="range"
                min="0"
                max="32"
                value={appearance.cornerRadius}
                onChange={(event) => updateAppearance({ cornerRadius: Number(event.target.value) })}
              />
              <output>{appearance.cornerRadius}px</output>
            </label>
            <label>
              Overlay{' '}
              <select
                value={overlayMode}
                onChange={(event) =>
                  void patchState((current) => ({
                    ...current,
                    overlayMode: event.target.value as WallState['overlayMode'],
                  }))
                }
              >
                <option value="off">Off</option>
                <option value="hover">On hover</option>
                <option value="always">Always</option>
              </select>
            </label>
          </div>
        </section>
        <P3WorkspacePanel
          state={state}
          templates={templates}
          presets={presets}
          saveState={patchState}
          saveTemplates={saveTemplates}
          savePresets={savePresets}
          onFeedback={setGlobalMessage}
        />
        <SourceLibraryPanel
          state={{ ...state, library: normalizeSourceLibrary(state.library) }}
          saveState={patchState}
          saveLibrary={saveLibrary}
          importLibrary={importLibrary}
          onFeedback={setGlobalMessage}
        />
        {state.tiles.length === 0 ? (
          <section className="admin-empty">
            <div>
              <MonitorPlay />
            </div>
            <span className="eyebrow">YOUR WALL IS STANDING BY</span>
            <h2>Add your first video source</h2>
            <p>Start with a YouTube video, live stream, HLS feed, or embeddable website.</p>
            <Button
              variant="primary"
              onClick={(event) => openDialog({ mode: 'add' }, event.currentTarget)}
            >
              <Plus /> Add Source
            </Button>
          </section>
        ) : (
          <section className="tile-list">
            <div className="list-heading">
              <div>
                <h2>Live tiles</h2>
                <span>{state.tiles.length} of 9</span>
              </div>
              <p>Select a tile’s audio button to make it the only audible source.</p>
            </div>
            {tiles.map((tile, index) => (
              <div
                key={tile.id}
                onDoubleClick={() => void setAudio(tile.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggedTileId)
                    void patchState((current) => reorderTile(current, draggedTileId, tile.id));
                  setDraggedTileId(undefined);
                }}
              >
                <TileCard
                  tile={tile}
                  isActiveAudio={state.activeAudioTileId === tile.id}
                  onSave={(change) => patchTile(tile.id, change)}
                  onDelete={() => deleteTile(tile)}
                  onEdit={() => openDialog({ mode: 'edit', tile })}
                  onReplace={() => openDialog({ mode: 'replace', tile })}
                  onRefreshTitle={() => void refreshTitle(tile)}
                  health={healthByTile[tile.id]}
                  onRetry={() => void command(tile.id, 'retry')}
                  onFocus={() =>
                    void patchState((current) => ({ ...current, focusedTileId: tile.id }))
                  }
                  onMoveUp={() => void patchState((current) => moveTile(current, tile.id, -1))}
                  onMoveDown={() => void patchState((current) => moveTile(current, tile.id, 1))}
                  moveUpDisabled={index === 0}
                  moveDownDisabled={index === tiles.length - 1}
                  onDragStart={(event) => {
                    setDraggedTileId(tile.id);
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData('text/plain', tile.id);
                  }}
                  onQueue={(source, playback) =>
                    patchState((current) => {
                      const recorded = recordSourceInState(
                        current,
                        source,
                        source.youtubeId || new URL(source.url).hostname,
                        'manual',
                      );
                      return {
                        ...recorded,
                        tiles: recorded.tiles.map((candidate) =>
                          candidate.id === tile.id
                            ? {
                                ...candidate,
                                queuedSource: source,
                                queuedPlayback: playback,
                                scheduledAt: undefined,
                              }
                            : candidate,
                        ),
                      };
                    })
                  }
                  onPlayNext={() => patchState((current) => playNextSource(current, tile.id))}
                  libraryEntry={normalizeSourceLibrary(state.library).entries.find(
                    (entry) => entry.canonicalUrl === canonicalSourceUrl(tile.source),
                  )}
                  onSaveToLibrary={(trigger) => openDialog({ mode: 'save', tile }, trigger)}
                  onToggleFavorite={() => toggleFavorite(tile)}
                  progress={progress?.entries?.find(
                    (entry) => entry.key === playbackKey(tile.source),
                  )}
                  onClearPosition={() => clearPlaybackProgress(tile.source.url)}
                  onCommand={(name, value) => {
                    if (name === 'unmute') void setAudio(tile.id);
                    else {
                      if (name === 'mute')
                        void patchTile(tile.id, (current) => ({ ...current, muted: true }));
                      void command(tile.id, name, value);
                    }
                  }}
                />
              </div>
            ))}
          </section>
        )}
        {state.layoutMode === 'freeform' && state.tiles.length > 0 && (
          <section className="layout-editor">
            <div className="list-heading">
              <div>
                <h2>Freeform layout</h2>
                <span>Drag and resize</span>
              </div>
              <Button variant="secondary" onClick={() => setLayoutEditing(!layoutEditing)}>
                {layoutEditing ? 'Done arranging' : 'Arrange tiles'}
              </Button>
            </div>
            <GridLayout
              layout={tiles.map((tile) => ({
                i: tile.id,
                x: tile.x,
                y: tile.y,
                w: tile.w,
                h: tile.h,
              }))}
              cols={12}
              rowHeight={40}
              width={980}
              isDraggable={layoutEditing}
              isResizable={layoutEditing}
              onDragStop={saveLayout}
              onResizeStop={saveLayout}
            >
              {tiles.map((tile) => (
                <div className="layout-box" key={tile.id}>
                  <Grip /> {tile.name}
                </div>
              ))}
            </GridLayout>
          </section>
        )}
      </section>
      {dialog?.mode === 'add' && (
        <SourceDialog
          kind="add"
          returnFocus={dialog.returnFocus}
          onClose={() => setDialog(undefined)}
          onSubmit={async ({ name, source, titleMode, saveToLibrary, playback }) => {
            await patchState((current) => {
              const recorded = recordSourceInState(current, source, name, titleMode);
              const library = saveToLibrary
                ? saveLibrarySource(recorded.library, source, name, titleMode, Date.now(), playback)
                : recorded.library;
              return {
                ...recorded,
                library,
                tiles: [
                  ...recorded.tiles,
                  {
                    ...newTile(name, source, titleMode),
                    playback,
                    displayOrder: recorded.tiles.length,
                  },
                ],
              };
            });
            if (saveToLibrary) setGlobalMessage(`Saved ‘${name}’ to Source Library.`);
          }}
        />
      )}
      {dialog?.mode === 'edit' && (
        <SourceDialog
          kind="edit"
          tile={dialog.tile}
          returnFocus={dialog.returnFocus}
          onClose={() => setDialog(undefined)}
          onSubmit={async ({ name, source, titleMode, saveToLibrary, playback }) => {
            await patchState((current) => ({
              ...current,
              tiles: current.tiles.map((tile) =>
                tile.id === dialog.tile.id ? { ...tile, name, titleMode, playback } : tile,
              ),
              library: saveToLibrary
                ? saveLibrarySource(current.library, source, name, titleMode, Date.now(), playback)
                : current.library,
            }));
            if (saveToLibrary) setGlobalMessage(`Saved ‘${name}’ to Source Library.`);
          }}
        />
      )}
      {dialog?.mode === 'replace' && (
        <SourceDialog
          kind="replace"
          tile={dialog.tile}
          returnFocus={dialog.returnFocus}
          onClose={() => setDialog(undefined)}
          onSubmit={async ({ name, source, titleMode, saveToLibrary, playback }) => {
            await patchState((current) => {
              const recorded = recordSourceInState(
                replaceTileSource(current, dialog.tile.id, { name, source, titleMode, playback }),
                source,
                name,
                titleMode,
              );
              return {
                ...recorded,
                library: saveToLibrary
                  ? saveLibrarySource(
                      recorded.library,
                      source,
                      name,
                      titleMode,
                      Date.now(),
                      playback,
                    )
                  : recorded.library,
              };
            });
            if (saveToLibrary) setGlobalMessage(`Saved ‘${name}’ to Source Library.`);
          }}
        />
      )}
      {dialog?.mode === 'save' && (
        <SourceDialog
          kind="save"
          tile={dialog.tile}
          returnFocus={dialog.returnFocus}
          onClose={() => setDialog(undefined)}
          onSubmit={async ({ name, source, titleMode, playback }) => {
            await saveLibrary(
              saveLibrarySource(state.library, source, name, titleMode, Date.now(), playback),
            );
            setGlobalMessage(`Saved ‘${name}’ to Source Library.`);
          }}
        />
      )}
    </main>
  );
}
