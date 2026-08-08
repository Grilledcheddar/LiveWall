import { Focus, Maximize, Minimize, Radio, Volume2, X } from 'lucide-react';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GridLayout from 'react-grid-layout';
import { Button } from '../components/Button';
import { PlayerTile } from '../components/PlayerTile';
import { useWall } from '../hooks/useWall';
import { wallLayoutForState } from '../lib/layouts';
import { normalizeAppearance, normalizeOverlayMode, orderedTiles } from '../lib/state';
import { playbackKey } from '../lib/playback';
import { canonicalSourceUrl } from '../lib/sources';

export function WallPage() {
  const {
    state,
    save,
    connected,
    lastCommand,
    commands,
    reportHealth,
    reportPlaybackProgress,
    progress,
    healthByTile = {},
    stateError,
  } = useWall();
  const tiles = useMemo(() => orderedTiles(state.tiles), [state.tiles]);
  const appearance = normalizeAppearance(state.appearance);
  const overlayMode = normalizeOverlayMode(state.overlayMode);
  const wallLayout = wallLayoutForState(state);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const [fullscreenError, setFullscreenError] = useState('');
  const [externalTvActive, setExternalTvActive] = useState(false);
  const audioActivationRequired = Object.values(healthByTile).some(
    (health) => health.audioActivationRequired,
  );
  const kioskLaunch = new URLSearchParams(window.location.search).get('launchMode') === 'kiosk';
  const hideTimer = useRef<number | undefined>(undefined);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2_400);
  }, []);

  useEffect(() => {
    const updateFullscreen = () => {
      setFullscreen(Boolean(document.fullscreenElement));
      revealControls();
    };
    window.addEventListener('mousemove', revealControls, { passive: true });
    window.addEventListener('pointermove', revealControls, { passive: true });
    document.addEventListener('fullscreenchange', updateFullscreen);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2_400);
    return () => {
      clearTimeout(hideTimer.current);
      window.removeEventListener('mousemove', revealControls);
      window.removeEventListener('pointermove', revealControls);
      document.removeEventListener('fullscreenchange', updateFullscreen);
    };
  }, [revealControls]);

  useEffect(() => {
    const escapeFocus = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state.focusedTileId && !document.fullscreenElement) {
        void save((current) => ({ ...current, focusedTileId: undefined }));
      }
    };
    document.addEventListener('keydown', escapeFocus);
    return () => document.removeEventListener('keydown', escapeFocus);
  }, [save, state.focusedTileId]);

  useEffect(() => {
    let mounted = true;
    const refresh = () =>
      fetch('/api/external-tv')
        .then((response) => response.json())
        .then((result) => mounted && setExternalTvActive(result.phase === 'external-active'))
        .catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  async function toggleFullscreen() {
    setFullscreenError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError(
        'Fullscreen was blocked by the browser. Click the Wall and try again, or press F11.',
      );
      revealControls();
    }
  }

  return (
    <>
      <main
        className={`wall ${tiles.length ? '' : 'empty-wall'} ${state.focusedTileId ? 'focus-mode' : ''}`}
        style={
          {
            '--wall-background': appearance.backgroundColor,
            '--wall-gap': `${appearance.gap}px`,
            '--tile-border': appearance.borderVisible
              ? `${appearance.borderWidth}px solid ${appearance.borderColor}`
              : '0 solid transparent',
            '--tile-radius': `${appearance.cornerRadius}px`,
          } as CSSProperties
        }
      >
        <div className={`wall-controls ${controlsVisible ? 'visible' : ''}`}>
          {!kioskLaunch && (
            <Button
              variant="ghost"
              className="fullscreen-button"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            >
              {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
              <span>{fullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}</span>
            </Button>
          )}
          {state.focusedTileId && (
            <Button
              variant="ghost"
              className="fullscreen-button"
              onClick={() => void save((current) => ({ ...current, focusedTileId: undefined }))}
            >
              <X size={17} /> <span>Exit Focus</span>
            </Button>
          )}
        </div>
        <div className={`wall-connection ${connected ? 'online' : ''}`}>
          {connected ? 'Live' : 'Reconnecting'}
        </div>
        {stateError && (
          <div className="state-error wall-state-error" role="alert">
            {stateError}
          </div>
        )}
        {!kioskLaunch && fullscreenError && (
          <div className="fullscreen-error" role="status">
            {fullscreenError}
          </div>
        )}
        {externalTvActive ? (
          <div className="external-tv-suspended" role="status">
            <div className="wall-brand">
              <Radio />
              <span>LIVEWALL</span>
            </div>
            <h1>External TV Mode is active.</h1>
            <p>
              The dedicated TV window controls this provider. The Wall will restore automatically
              when it closes.
            </p>
          </div>
        ) : !tiles.length ? (
          <div className="empty-wall-content">
            <div className="wall-brand">
              <Radio />
              <span>LIVEWALL</span>
            </div>
            <h1>Your wall is ready.</h1>
            <p>Add a source from the Admin window. It will appear here automatically.</p>
            <a href="/admin">Open Admin</a>
          </div>
        ) : (
          <GridLayout
            className={state.layoutMode === 'automatic' ? 'auto-wall' : 'freeform-wall'}
            layout={wallLayout}
            cols={12}
            rowHeight={window.innerHeight / 12}
            width={window.innerWidth}
            margin={[appearance.gap, appearance.gap]}
            isDraggable={false}
            isResizable={false}
          >
            {tiles.map((tile) => (
              <div
                key={tile.id}
                className={`wall-tile-host ${state.focusedTileId === tile.id ? 'focused' : 'unfocused'}`}
              >
                <PlayerTile
                  tile={tile}
                  command={lastCommand}
                  commands={commands}
                  stopped={state.globallyStopped}
                  overlayMode={overlayMode}
                  focused={state.focusedTileId === tile.id}
                  activeAudio={state.activeAudioTileId === tile.id}
                  qualityPreference={state.qualityPreferences?.[canonicalSourceUrl(tile.source)]}
                  onHealth={reportHealth}
                  progress={progress?.entries?.find(
                    (entry) => entry.key === playbackKey(tile.source),
                  )}
                  onPlaybackProgress={reportPlaybackProgress}
                />
                <Button
                  variant="ghost"
                  className="tile-focus-button"
                  aria-label={`Focus ${tile.name}`}
                  onClick={() => void save((current) => ({ ...current, focusedTileId: tile.id }))}
                >
                  <Focus size={15} />
                </Button>
              </div>
            ))}
          </GridLayout>
        )}
      </main>
      {audioActivationRequired &&
        createPortal(
          <Button
            variant="primary"
            type="button"
            className="audio-activation-overlay"
            onClick={() => window.dispatchEvent(new Event('livewall-enable-audio'))}
          >
            <Volume2 size={22} />
            <strong>Enable Audio</strong>
            <span>Click once to allow sound in this Wall window.</span>
          </Button>,
          document.body,
        )}
    </>
  );
}
