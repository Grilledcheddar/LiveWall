import Hls from 'hls.js';
import { ExternalLink, LoaderCircle, MonitorX, RotateCw, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  HlsQualityLevel,
  OverlayMode,
  PlayerCommand,
  PlayerHealth,
  PlayerHealthStatus,
  Tile,
  PlaybackProgress,
  QualityPreference,
} from '../lib/types';
import { resumeTarget, PROGRESS_INTERVAL_MS } from '../lib/playback';
import { resolveHlsQualityLevel } from '../lib/quality';
import { getEmbedPolicy } from '../lib/embed-policy';

interface Adapter {
  play(): void | Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  getPosition(): number | undefined;
  getDuration(): number | undefined;
  isLive(): boolean;
  goLive(): void;
  getPlaylistIndex(): number | undefined;
  previous(): void;
  next(): void;
  isMuted(): boolean | undefined;
  destroy(): void;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeReady: Promise<any> | undefined;
function loadYouTube() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!youtubeReady) {
    const request = new Promise<any>((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      const readinessTimeout = window.setTimeout(() => {
        if (youtubeReady === request) youtubeReady = undefined;
        reject(new Error('The YouTube IFrame API did not become ready.'));
      }, 10_000);
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(readinessTimeout);
        previous?.();
        resolve(window.YT);
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = () => {
          clearTimeout(readinessTimeout);
          if (youtubeReady === request) youtubeReady = undefined;
          reject(new Error('The YouTube IFrame API script could not be loaded.'));
        };
        document.head.appendChild(script);
      }
    });
    youtubeReady = request;
  }
  return youtubeReady;
}

export const PlayerTile = memo(function PlayerTile({
  tile,
  command,
  commands,
  stopped = false,
  overlayMode = 'hover',
  focused = false,
  activeAudio = false,
  onHealth,
  progress,
  onPlaybackProgress,
  onResumePosition,
  qualityPreference = { mode: 'auto' },
}: {
  tile: Tile;
  command?: PlayerCommand;
  commands?: PlayerCommand[];
  stopped?: boolean;
  overlayMode?: OverlayMode;
  focused?: boolean;
  activeAudio?: boolean;
  onHealth?: (health: PlayerHealth) => void;
  progress?: PlaybackProgress;
  onPlaybackProgress?: (
    sourceUrl: string,
    position: number,
    duration?: number,
    playlistIndex?: number,
  ) => void;
  onResumePosition?: (tileId: string, sourceUrl: string, position: number) => void;
  qualityPreference?: QualityPreference;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const adapter = useRef<Adapter | undefined>(undefined);
  const adapterReady = useRef(false);
  const pendingControls = useRef({ muted: tile.muted, volume: tile.volume });
  const pendingCommands = useRef<PlayerCommand[]>([]);
  const requestedPlayback = useRef<'playing' | 'paused'>('playing');
  const audioActivationRequired = useRef(false);
  const audioActivationEpoch = useRef(0);
  const processedCommandIds = useRef(new Set<string>());
  const retryTimer = useRef<number | undefined>(undefined);
  const retryAttempt = useRef(0);
  const lastReadyAt = useRef<number | undefined>(undefined);
  const sourceKey = `${tile.source.type}:${tile.source.url}`;
  const currentSourceKey = useRef(sourceKey);
  const [retryNonce, setRetryNonce] = useState(0);
  const [status, setStatus] = useState<PlayerHealthStatus>(stopped ? 'stopped' : 'initializing');
  const statusRef = useRef<PlayerHealthStatus>(status);
  const [message, setMessage] = useState(
    stopped ? 'Players are stopped.' : 'Connecting to source…',
  );
  const [technicalDetail, setTechnicalDetail] = useState('');
  const [controlMessage, setControlMessage] = useState('');
  const messageTimer = useRef<number | undefined>(undefined);
  const audioCheckTimer = useRef<number | undefined>(undefined);
  const latestName = useRef(tile.name);
  const liveSource = useRef(false);
  const hlsRef = useRef<Hls | undefined>(undefined);
  const hlsLevelsRef = useRef<HlsQualityLevel[]>([]);
  const qualityPreferenceRef = useRef(qualityPreference);
  const qualityHealthRef = useRef<Partial<PlayerHealth>>({});
  const playbackRef = useRef(tile.playback);
  const progressRef = useRef(progress);
  latestName.current = tile.name;
  playbackRef.current = tile.playback;
  progressRef.current = progress;
  qualityPreferenceRef.current = qualityPreference;

  const publish = useCallback(
    (
      nextStatus: PlayerHealthStatus,
      nextMessage?: string,
      detail?: string,
      retry?: number,
      nextRetryAt?: number,
      detailState?: Partial<PlayerHealth>,
    ) => {
      if (['ready', 'playing'].includes(nextStatus)) lastReadyAt.current = Date.now();
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      if (nextMessage !== undefined) setMessage(nextMessage);
      if (detail !== undefined) setTechnicalDetail(detail);
      onHealth?.({
        tileId: tile.id,
        sourceUrl: tile.source.url,
        status: nextStatus,
        changedAt: Date.now(),
        lastReadyAt: lastReadyAt.current,
        message: nextMessage,
        technicalDetail: detail,
        retryAttempt: retry,
        nextRetryAt,
        ...qualityHealthRef.current,
        ...detailState,
      });
    },
    [onHealth, tile.id, tile.source.url],
  );

  const reportControlFailure = useCallback(
    (label: string, error?: unknown) => {
      const activation = (label === 'Play' || label === 'Unmute') && !pendingControls.current.muted;
      if (activation) {
        audioActivationEpoch.current += 1;
        audioActivationRequired.current = true;
        publish(
          statusRef.current,
          'Wall audio needs activation.',
          error instanceof Error ? error.message : 'autoplay-with-sound-rejected',
          undefined,
          undefined,
          { audioActivationRequired: true, muted: true },
        );
      }
      setControlMessage(
        activation
          ? 'Wall audio needs activation.'
          : `${label} could not be applied. The player is still connected.`,
      );
      clearTimeout(messageTimer.current);
      messageTimer.current = window.setTimeout(() => setControlMessage(''), 4_000);
    },
    [publish],
  );

  const runControl = useCallback(
    (label: string, action: (current: Adapter) => void | Promise<void>) => {
      if (!adapter.current || !adapterReady.current) return false;
      try {
        const result = action(adapter.current);
        if (result && typeof result.then === 'function') {
          void result.catch((error) => reportControlFailure(label, error));
        }
        return true;
      } catch (error) {
        reportControlFailure(label, error);
        return false;
      }
    },
    [reportControlFailure],
  );

  const capturePosition = useCallback(() => {
    const position = adapter.current?.getPosition();
    if (
      !liveSource.current &&
      typeof position === 'number' &&
      Number.isFinite(position) &&
      position >= 0
    ) {
      onPlaybackProgress?.(
        tile.source.url,
        position,
        adapter.current?.getDuration(),
        adapter.current?.getPlaylistIndex(),
      );
      onResumePosition?.(tile.id, tile.source.url, position);
    }
  }, [onPlaybackProgress, onResumePosition, tile.id, tile.source.url]);

  const verifyAudioActivation = useCallback(() => {
    clearTimeout(audioCheckTimer.current);
    const expectedEpoch = audioActivationEpoch.current;
    audioCheckTimer.current = window.setTimeout(() => {
      if (expectedEpoch !== audioActivationEpoch.current) return;
      if (pendingControls.current.muted) return;
      if (adapter.current?.isMuted() !== true) {
        audioActivationRequired.current = false;
        publish(
          statusRef.current,
          statusRef.current === 'playing' ? 'Playing' : undefined,
          undefined,
          undefined,
          undefined,
          { audioActivationRequired: false, muted: false },
        );
        return;
      }
      audioActivationRequired.current = true;
      audioActivationEpoch.current += 1;
      publish(
        statusRef.current,
        'Wall audio needs activation.',
        'browser-kept-player-muted',
        undefined,
        undefined,
        { audioActivationRequired: true, muted: true },
      );
    }, 600);
  }, [publish]);

  const stopPlayer = useCallback(() => {
    clearTimeout(retryTimer.current);
    capturePosition();
    adapter.current?.destroy();
    adapter.current = undefined;
    adapterReady.current = false;
    mount.current?.replaceChildren();
    publish('stopped', 'Players are stopped. Resume All to reconnect.');
  }, [capturePosition, publish]);

  const runPlayerCommand = useCallback(
    (next: PlayerCommand) => {
      if (next.command === 'volume') pendingControls.current.volume = next.value ?? 0;
      if (next.command === 'mute') {
        pendingControls.current.muted = true;
        audioActivationRequired.current = false;
        audioActivationEpoch.current += 1;
      }
      if (next.command === 'unmute') pendingControls.current.muted = false;
      if (next.command === 'play' || next.command === 'resume')
        requestedPlayback.current = 'playing';
      if (next.command === 'pause') requestedPlayback.current = 'paused';
      if (next.command === 'stop') return stopPlayer();
      if (next.command === 'retry') {
        retryAttempt.current = 0;
        clearTimeout(retryTimer.current);
        setRetryNonce((value) => value + 1);
        return;
      }
      if (
        tile.source.type === 'website' &&
        ['play', 'pause', 'resume', 'seek'].includes(next.command)
      )
        return;
      if (!adapterReady.current) {
        pendingCommands.current.push(next);
        return;
      }
      if (next.command === 'go-live') {
        const applied = runControl('Go Live', (current) => current.goLive());
        if (applied)
          publish('playing', 'LIVE', undefined, undefined, undefined, {
            isLive: true,
            atLiveEdge: true,
          });
        return;
      }
      if (next.command === 'restart') return runControl('Restart', (current) => current.seek(0));
      if (next.command === 'previous') {
        capturePosition();
        return runControl('Previous video', (current) => current.previous());
      }
      if (next.command === 'next') {
        capturePosition();
        return runControl('Next video', (current) => current.next());
      }
      if (next.command === 'play' || next.command === 'resume') {
        runControl('Play', (current) => current.play());
      }
      if (next.command === 'pause') {
        runControl('Pause', (current) => current.pause());
        capturePosition();
      }
      if (next.command === 'seek') runControl('Seek', (current) => current.seek(next.value ?? 0));
      if (next.command === 'mute') runControl('Mute', (current) => current.setMuted(true));
      if (next.command === 'unmute') {
        runControl('Unmute', (current) => current.setMuted(false));
        verifyAudioActivation();
      }
      if (next.command === 'volume')
        runControl('Volume', (current) => current.setVolume(next.value ?? 0));
    },
    [capturePosition, publish, runControl, stopPlayer, tile.source.type, verifyAudioActivation],
  );

  const applyPendingControls = useCallback(() => {
    runControl('Volume', (current) => current.setVolume(pendingControls.current.volume));
    runControl('Mute', (current) => current.setMuted(pendingControls.current.muted));
    const commands = pendingCommands.current.splice(0);
    commands.forEach(runPlayerCommand);
  }, [runControl, runPlayerCommand]);

  const applyStartBehavior = useCallback(() => {
    const current = adapter.current;
    if (!current) return;
    liveSource.current = current.isLive();
    if (liveSource.current) {
      current.goLive();
      return;
    }
    const behavior = playbackRef.current?.behavior ?? 'resume';
    if (behavior === 'beginning') current.seek(0);
    else if (behavior === 'specific') current.seek(playbackRef.current?.specificTime ?? 0);
    else if (behavior === 'resume')
      current.seek(
        resumeTarget(
          progressRef.current ??
            (typeof tile.resumePosition === 'number'
              ? { position: tile.resumePosition, duration: undefined }
              : undefined),
        ),
      );
  }, [tile.resumePosition]);

  const scheduleRetry = useCallback(
    (friendly: string, detail: string) => {
      const attempt = retryAttempt.current + 1;
      if (attempt > 3) {
        publish('failed', `${friendly} Automatic retry limit reached.`, detail, 3);
        return;
      }
      retryAttempt.current = attempt;
      const delay = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      const expectedSource = currentSourceKey.current;
      publish(
        'retrying',
        `${friendly} Retrying automatically.`,
        detail,
        attempt,
        Date.now() + delay,
      );
      clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => {
        if (currentSourceKey.current === expectedSource) setRetryNonce((value) => value + 1);
      }, delay);
    },
    [publish],
  );

  useEffect(() => {
    if (currentSourceKey.current !== sourceKey) {
      clearTimeout(retryTimer.current);
      retryAttempt.current = 0;
      lastReadyAt.current = undefined;
      currentSourceKey.current = sourceKey;
      pendingCommands.current = [];
    }
  }, [sourceKey]);

  useEffect(() => {
    const node = mount.current;
    if (!node) return;
    let disposed = false;
    let timeout: number | undefined;
    adapterReady.current = false;
    node.replaceChildren();
    if (stopped) {
      publish('stopped', 'Players are stopped. Resume All to reconnect.');
      return;
    }
    publish('initializing', 'Initializing player…');

    const ready = (nextStatus: PlayerHealthStatus = 'ready') => {
      retryAttempt.current = 0;
      adapterReady.current = true;
      applyStartBehavior();
      applyPendingControls();
      const isLive = adapter.current?.isLive() ?? false;
      const position = adapter.current?.getPosition();
      const duration = adapter.current?.getDuration();
      publish(
        nextStatus,
        isLive ? 'LIVE' : nextStatus === 'playing' ? 'Playing' : 'Ready',
        undefined,
        undefined,
        undefined,
        {
          isLive,
          atLiveEdge:
            isLive && typeof position === 'number'
              ? duration === undefined || duration - position < 5
              : undefined,
          position,
          duration,
          playlistIndex: adapter.current?.getPlaylistIndex(),
        },
      );
    };

    if (tile.source.type === 'mock') {
      const mock = document.createElement('div');
      const badge = document.createElement('span');
      const title = document.createElement('strong');
      mock.className = 'mock-player';
      mock.dataset.source = tile.source.url;
      mock.dataset.instanceId = crypto.randomUUID();
      badge.textContent = 'LIVEWALL TEST SOURCE';
      const parameters = new URL(tile.source.url).searchParams;
      title.textContent = parameters.get('label') || latestName.current;
      mock.append(badge, title);
      node.appendChild(mock);
      let mockPosition = Number(parameters.get('position')) || 0;
      const setMockPosition = (position: number) => {
        mockPosition = Math.max(0, position);
        mock.dataset.position = String(mockPosition);
      };
      setMockPosition(mockPosition);
      const mockDuration = Number(parameters.get('duration')) || 3600;
      const mockLive = parameters.get('live') === '1';
      const mockPlaylist = (parameters.get('playlist') ?? '').split(',').filter(Boolean);
      let mockMuted = pendingControls.current.muted;
      let mockPlayRejected = false;
      mock.dataset.muted = String(mockMuted);
      mock.dataset.playing = 'true';
      mock.dataset.volume = String(pendingControls.current.volume);
      let mockPlaylistIndex = Math.min(
        Math.max(0, mockPlaylist.length - 1),
        Math.max(0, progressRef.current?.playlistIndex ?? tile.playlistIndex ?? 0),
      );
      adapter.current = {
        ...emptyAdapter,
        play: () => {
          if (parameters.get('rejectPlay') === '1' && !mockPlayRejected) {
            mockPlayRejected = true;
            return Promise.reject(new DOMException('NotAllowedError'));
          }
          mock.dataset.playing = 'true';
          publish('playing', 'Playing', undefined, undefined, undefined, { muted: mockMuted });
        },
        pause: () => {
          mock.dataset.playing = 'false';
          publish('paused', 'Paused', undefined, undefined, undefined, { muted: mockMuted });
        },
        setMuted: (muted) => {
          mockMuted = muted;
          mock.dataset.muted = String(muted);
        },
        setVolume: (volume) => {
          mock.dataset.volume = String(volume);
        },
        isMuted: () => mockMuted,
        seek: setMockPosition,
        getPosition: () => mockPosition,
        getDuration: () => (mockLive ? undefined : mockDuration),
        isLive: () => mockLive,
        goLive: () => setMockPosition(mockDuration),
        getPlaylistIndex: () => (mockPlaylist.length ? mockPlaylistIndex : undefined),
        previous: () => {
          mockPlaylistIndex = Math.max(0, mockPlaylistIndex - 1);
          publish('playing', 'Playing playlist item', undefined, undefined, undefined, {
            playlistIndex: mockPlaylistIndex,
            playlistLength: mockPlaylist.length,
            currentTitle: mockPlaylist[mockPlaylistIndex],
            upNextTitle: mockPlaylist[mockPlaylistIndex + 1],
          });
        },
        next: () => {
          if (mockPlaylistIndex < mockPlaylist.length - 1) {
            mockPlaylistIndex += 1;
            publish('playing', 'Playing playlist item', undefined, undefined, undefined, {
              playlistIndex: mockPlaylistIndex,
              playlistLength: mockPlaylist.length,
              currentTitle: mockPlaylist[mockPlaylistIndex],
              upNextTitle: mockPlaylist[mockPlaylistIndex + 1],
            });
          } else {
            publish('paused', 'Playlist complete', undefined, undefined, undefined, {
              playlistIndex: mockPlaylistIndex,
              playlistLength: mockPlaylist.length,
              currentTitle: mockPlaylist[mockPlaylistIndex],
            });
          }
        },
      };
      if (parameters.get('health') === 'recoverable' && retryAttempt.current < 1) {
        scheduleRetry('Test source disconnected.', 'mock:recoverable');
      } else if (parameters.get('health') === 'failed') {
        publish('failed', 'Test source failed.', 'mock:failed', 3);
      } else ready('playing');
    } else if (tile.source.type === 'youtube' || tile.source.type === 'youtube-playlist') {
      const playerNode = document.createElement('div');
      const isPlaylist = tile.source.type === 'youtube-playlist';
      node.appendChild(playerNode);
      timeout = window.setTimeout(() => {
        if (disposed || adapterReady.current) return;
        publish(
          'failed',
          'YouTube did not become ready. Select Retry now, or open the source externally.',
          'youtube-readiness-timeout',
        );
      }, 12_000);
      loadYouTube()
        .then((YT) => {
          if (disposed) return;
          publish('loading', isPlaylist ? 'Loading playlist…' : 'Loading video…');
          let startingVideoApplied = false;
          const player = new YT.Player(playerNode, {
            ...(isPlaylist ? {} : { videoId: tile.source.youtubeId }),
            playerVars: {
              autoplay: 1,
              mute: 1,
              playsinline: 1,
              rel: 0,
              origin: location.origin,
            },
            events: {
              onReady: () => {
                if (disposed) return;
                clearTimeout(timeout);
                if (isPlaylist) {
                  publish('loading', 'Loading playlist…');
                  player.setLoop?.(false);
                  player.loadPlaylist({
                    listType: 'playlist',
                    list: tile.source.playlistId,
                    index:
                      progressRef.current?.playlistIndex ??
                      tile.playlistIndex ??
                      tile.source.playlistStartIndex ??
                      0,
                    startSeconds:
                      playbackRef.current?.behavior === 'specific'
                        ? playbackRef.current.specificTime
                        : (progressRef.current?.position ?? tile.resumePosition ?? 0),
                  });
                }
                ready();
              },
              onStateChange: (event: { data: number }) => {
                const list = (player.getPlaylist?.() ?? []) as string[];
                const index = Math.max(0, Number(player.getPlaylistIndex?.()) || 0);
                if (
                  isPlaylist &&
                  !startingVideoApplied &&
                  tile.source.playlistStartVideoId &&
                  list.length
                ) {
                  startingVideoApplied = true;
                  const startingIndex = list.indexOf(tile.source.playlistStartVideoId);
                  if (startingIndex >= 0 && startingIndex !== index) {
                    player.playVideoAt(startingIndex);
                    return;
                  }
                }
                if (isPlaylist && event.data === 0 && list.length > 0 && index >= list.length - 1) {
                  player.stopVideo();
                  capturePosition();
                  requestedPlayback.current = 'paused';
                  publish('ended', 'Playlist complete', undefined, undefined, undefined, {
                    playlistIndex: index,
                    playlistLength: list.length,
                  });
                  return;
                }
                if (event.data === 2 || event.data === 0) capturePosition();
                const mapped: Record<number, PlayerHealthStatus> = {
                  [-1]: 'loading',
                  0: 'ended',
                  1: 'playing',
                  2: 'paused',
                  3: 'buffering',
                  5: 'ready',
                };
                const stateMessage: Record<number, string> = {
                  [-1]: isPlaylist ? 'Loading playlist…' : 'Loading video…',
                  0: 'Ended',
                  1: 'Playing',
                  2: 'Paused',
                  3: 'Buffering',
                  5: 'Ready',
                };
                const data = player.getVideoData?.() ?? {};
                const duration = Number(player.getDuration?.()) || undefined;
                const position = Number(player.getCurrentTime?.()) || 0;
                const isLive = Boolean(data.isLive) || duration === 0;
                const muted = Boolean(player.isMuted?.());
                if (event.data === 1 && !muted) audioActivationRequired.current = false;
                publish(
                  mapped[event.data] ?? 'unknown',
                  stateMessage[event.data] ?? 'Player state unavailable',
                  undefined,
                  undefined,
                  undefined,
                  {
                    isLive,
                    atLiveEdge: isLive
                      ? duration === undefined || duration - position < 5
                      : undefined,
                    position,
                    duration,
                    playlistIndex: isPlaylist ? index : undefined,
                    playlistLength: isPlaylist ? list.length : undefined,
                    currentTitle: typeof data.title === 'string' ? data.title : undefined,
                    muted,
                    audioActivationRequired: audioActivationRequired.current,
                  },
                );
              },
              onError: (event: { data: number }) => {
                const friendly =
                  event.data === 153
                    ? 'YouTube rejected the page referrer (Error 153).'
                    : 'YouTube could not play this video.';
                if (isPlaylist && event.data !== 153) {
                  player.nextVideo();
                  publish(
                    'buffering',
                    'Skipped an unavailable playlist item.',
                    `youtube:${event.data}`,
                    undefined,
                    undefined,
                    {
                      warning:
                        'A private, deleted, restricted, or unavailable playlist item was skipped.',
                    },
                  );
                } else scheduleRetry(friendly, `youtube:${event.data}`);
              },
              onAutoplayBlocked: () => {
                if (!pendingControls.current.muted) {
                  audioActivationEpoch.current += 1;
                  audioActivationRequired.current = true;
                  publish(
                    'paused',
                    'Wall audio needs activation.',
                    'youtube-autoplay-blocked',
                    undefined,
                    undefined,
                    { audioActivationRequired: true, muted: true },
                  );
                } else {
                  publish(
                    'paused',
                    'Autoplay was blocked. Select Play to retry.',
                    'youtube-autoplay-blocked',
                  );
                }
              },
            },
          });
          adapter.current = {
            play: () => player.playVideo(),
            pause: () => player.pauseVideo(),
            seek: (seconds) => player.seekTo(seconds, true),
            setMuted: (muted) => (muted ? player.mute() : player.unMute()),
            setVolume: (volume) => player.setVolume(volume),
            getPosition: () => Number(player.getCurrentTime?.()) || 0,
            getDuration: () => Number(player.getDuration?.()) || undefined,
            isLive: () => Boolean(player.getVideoData?.()?.isLive) || player.getDuration?.() === 0,
            goLive: () => {
              const duration = Number(player.getDuration?.());
              if (Number.isFinite(duration) && duration > 0)
                player.seekTo(Math.max(0, duration - 2), true);
              player.playVideo();
            },
            getPlaylistIndex: () =>
              isPlaylist ? Math.max(0, Number(player.getPlaylistIndex?.()) || 0) : undefined,
            previous: () => isPlaylist && player.previousVideo(),
            next: () => isPlaylist && player.nextVideo(),
            isMuted: () => Boolean(player.isMuted?.()),
            destroy: () => player.destroy(),
          };
        })
        .catch((error: unknown) => {
          if (disposed) return;
          clearTimeout(timeout);
          publish(
            'failed',
            'YouTube could not initialize. Select Retry now, or open the source externally.',
            error instanceof Error ? error.message : 'youtube-api-load-failed',
          );
        });
    } else if (tile.source.type === 'hls') {
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = pendingControls.current.muted;
      video.volume = pendingControls.current.volume / 100;
      video.playsInline = true;
      node.appendChild(video);
      let hls: Hls | undefined;
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = tile.source.url;
      else if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(tile.source.url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!hls) return;
          const levels = hls.levels.map((level, index) => ({
            index,
            height: level.height || undefined,
            bitrate: level.bitrate || undefined,
          }));
          hlsLevelsRef.current = levels;
          const selected = resolveHlsQualityLevel(levels, qualityPreferenceRef.current);
          hls.nextLevel = selected.index;
          qualityHealthRef.current = {
            qualityLevels: levels,
            qualityCurrentLevel: hls.currentLevel,
            qualityAuto: selected.index === -1,
            qualityFallback: selected.fallback,
          };
          publish(statusRef.current, undefined, undefined, undefined, undefined);
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
          qualityHealthRef.current = {
            ...qualityHealthRef.current,
            qualityCurrentLevel: data.level,
          };
          publish(statusRef.current, undefined, undefined, undefined, undefined);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal)
            scheduleRetry('This HLS stream could not be loaded.', `${data.type}:${data.details}`);
          else publish('buffering', 'The stream is recovering.', `${data.type}:${data.details}`);
        });
      } else {
        publish('unsupported', 'HLS playback is not supported by this browser.');
      }
      video.onplaying = () => ready('playing');
      video.onpause = () => publish('paused', 'Paused');
      video.onwaiting = () => publish('buffering', 'Buffering');
      video.onerror = () =>
        scheduleRetry('This HLS stream could not be loaded.', 'native-hls-error');
      adapter.current = {
        play: () => video.play(),
        pause: () => video.pause(),
        seek: (seconds) => (video.currentTime = seconds),
        setMuted: (muted) => (video.muted = muted),
        setVolume: (volume) => (video.volume = volume / 100),
        getPosition: () => (Number.isFinite(video.currentTime) ? video.currentTime : undefined),
        getDuration: () =>
          Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined,
        isLive: () => !Number.isFinite(video.duration) || video.duration === Infinity,
        goLive: () => {
          if (video.seekable.length)
            video.currentTime = Math.max(0, video.seekable.end(video.seekable.length - 1) - 2);
          void video.play();
        },
        getPlaylistIndex: () => undefined,
        previous() {},
        next() {},
        isMuted: () => video.muted,
        destroy: () => {
          hls?.destroy();
          hlsRef.current = undefined;
          hlsLevelsRef.current = [];
          qualityHealthRef.current = {};
          video.removeAttribute('src');
          video.load();
        },
      };
      adapterReady.current = true;
      applyStartBehavior();
      applyPendingControls();
    } else {
      const embedPolicy = getEmbedPolicy({ type: tile.source.type, url: tile.source.url });
      if (tile.source.embedProfile === 'external' || embedPolicy?.externalOnly) {
        publish(
          'unsupported',
          embedPolicy?.message ??
            'External Only source. Use Watch on Wall to open it in the dedicated TV window.',
        );
        adapter.current = emptyAdapter;
        adapterReady.current = true;
        applyPendingControls();
        return () => {
          adapter.current = undefined;
          adapterReady.current = false;
          node.replaceChildren();
        };
      }
      const frame = document.createElement('iframe');
      frame.src = tile.source.url;
      const compatibility = tile.source.embedProfile === 'compatibility';
      frame.allow = 'autoplay; fullscreen; picture-in-picture; encrypted-media';
      frame.allowFullscreen = true;
      frame.referrerPolicy =
        tile.source.embedReferrerPolicy === 'strict-origin-when-cross-origin'
          ? 'strict-origin-when-cross-origin'
          : 'no-referrer';
      frame.setAttribute(
        'sandbox',
        compatibility
          ? 'allow-scripts allow-same-origin allow-presentation allow-forms'
          : 'allow-scripts allow-same-origin allow-presentation',
      );
      frame.title = latestName.current;
      frame.onload = () =>
        publish('unknown', 'Embedded page loaded; provider playback state is unavailable.');
      node.appendChild(frame);
      timeout = window.setTimeout(
        () => publish('unsupported', 'The provider may block embedding.'),
        8_000,
      );
      adapter.current = emptyAdapter;
      adapterReady.current = true;
      applyPendingControls();
    }
    return () => {
      disposed = true;
      clearTimeout(timeout);
      adapter.current?.destroy();
      adapter.current = undefined;
      adapterReady.current = false;
      node.replaceChildren();
    };
  }, [
    applyPendingControls,
    applyStartBehavior,
    capturePosition,
    publish,
    retryNonce,
    runControl,
    scheduleRetry,
    stopped,
    tile.source.type,
    tile.source.url,
    tile.source.youtubeId,
    tile.source.playlistId,
    tile.source.playlistStartIndex,
    tile.source.playlistStartVideoId,
    tile.source.embedProfile,
    tile.source.embedReferrerPolicy,
    tile.playlistIndex,
    tile.resumePosition,
  ]);

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;
    const selected = resolveHlsQualityLevel(hlsLevelsRef.current, qualityPreference);
    // nextLevel switches on the next fragment and avoids destroying or seeking the player.
    hls.nextLevel = selected.index;
    qualityHealthRef.current = {
      ...qualityHealthRef.current,
      qualityAuto: selected.index === -1,
      qualityFallback: selected.fallback,
    };
    publish(statusRef.current, undefined, undefined, undefined, undefined);
  }, [publish, qualityPreference]);

  useEffect(() => {
    if (stopped || tile.source.type === 'website') return;
    const timer = window.setInterval(capturePosition, PROGRESS_INTERVAL_MS);
    const pageHide = () => capturePosition();
    window.addEventListener('pagehide', pageHide);
    return () => {
      clearInterval(timer);
      window.removeEventListener('pagehide', pageHide);
    };
  }, [capturePosition, stopped, tile.source.type]);

  useEffect(() => {
    pendingControls.current.muted = tile.muted;
    runControl('Mute', (current) => current.setMuted(tile.muted));
  }, [runControl, tile.muted]);
  useEffect(() => {
    pendingControls.current.volume = tile.volume;
    runControl('Volume', (current) => current.setVolume(tile.volume));
  }, [runControl, tile.volume]);

  useEffect(() => {
    const activate = () => {
      if (!audioActivationRequired.current || pendingControls.current.muted) return;
      audioActivationRequired.current = false;
      runControl('Unmute', (current) => current.setMuted(false));
      if (requestedPlayback.current === 'playing') runControl('Play', (current) => current.play());
      verifyAudioActivation();
    };
    window.addEventListener('livewall-enable-audio', activate);
    return () => window.removeEventListener('livewall-enable-audio', activate);
  }, [runControl, verifyAudioActivation]);
  useEffect(() => {
    const received = commands?.length ? commands : command ? [command] : [];
    received.forEach((next) => {
      if (
        processedCommandIds.current.has(next.id) ||
        (next.tileId !== tile.id && next.tileId !== '*')
      )
        return;
      processedCommandIds.current.add(next.id);
      runPlayerCommand(next);
    });
  }, [command, commands, runPlayerCommand, tile.id]);
  useEffect(
    () => () => {
      clearTimeout(messageTimer.current);
      clearTimeout(audioCheckTimer.current);
      clearTimeout(retryTimer.current);
      capturePosition();
    },
    [capturePosition],
  );

  const showState = [
    'initializing',
    'loading',
    'retrying',
    'stopped',
    'failed',
    'unsupported',
  ].includes(status);
  return (
    <article
      className={`player-tile overlay-${overlayMode} ${focused ? 'is-focused' : ''}`}
      data-tile-id={tile.id}
      data-health={status}
      tabIndex={overlayMode === 'off' ? undefined : 0}
      aria-label={`${tile.name} player`}
    >
      <div className="player-mount" ref={mount} />
      {showState && (
        <div
          className={`player-state ${['failed', 'unsupported'].includes(status) ? 'player-error' : ''}`}
        >
          {['loading', 'retrying'].includes(status) ? (
            <LoaderCircle className="spin" />
          ) : status === 'stopped' ? (
            <Square />
          ) : (
            <MonitorX />
          )}
          <strong>
            {status === 'retrying'
              ? 'Reconnecting'
              : status === 'initializing'
                ? 'Initializing'
                : status === 'stopped'
                  ? 'Stopped'
                  : status === 'failed'
                    ? 'Source unavailable'
                    : status === 'unsupported'
                      ? 'Unsupported or blocked'
                      : 'Loading'}
          </strong>
          <span>{message}</span>
          {technicalDetail && <small title={technicalDetail}>{technicalDetail}</small>}
          {['failed', 'unsupported'].includes(status) && (
            <a href={tile.source.url} target="_blank" rel="noreferrer">
              <ExternalLink size={14} /> Open externally
            </a>
          )}
        </div>
      )}
      {overlayMode !== 'off' && (
        <div className="tile-label" aria-hidden="true">
          <span>{tile.name}</span>
          <em className={`health health-${status}`}>
            <RotateCw size={10} /> {status}
          </em>
          <em className={activeAudio ? 'live-audio' : ''}>
            {activeAudio ? 'Audio' : tile.muted ? 'Muted' : 'Audible'}
          </em>
        </div>
      )}
      {controlMessage && (
        <div className="control-message" role="status">
          {controlMessage}
        </div>
      )}
    </article>
  );
});

const emptyAdapter: Adapter = {
  play() {},
  pause() {},
  seek() {},
  setMuted() {},
  setVolume() {},
  getPosition: () => undefined,
  getDuration: () => undefined,
  isLive: () => false,
  goLive() {},
  getPlaylistIndex: () => undefined,
  previous() {},
  next() {},
  isMuted: () => undefined,
  destroy() {},
};
