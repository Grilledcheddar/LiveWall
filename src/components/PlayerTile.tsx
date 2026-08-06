import Hls from 'hls.js';
import { ExternalLink, LoaderCircle, MonitorX, RotateCw, Square } from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type {
  OverlayMode,
  PlayerCommand,
  PlayerHealth,
  PlayerHealthStatus,
  Tile,
} from '../lib/types';

interface Adapter {
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  getPosition(): number | undefined;
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
    youtubeReady = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve(window.YT);
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        document.head.appendChild(script);
      }
    });
  }
  return youtubeReady;
}

export const PlayerTile = memo(function PlayerTile({
  tile,
  command,
  stopped = false,
  overlayMode = 'hover',
  focused = false,
  activeAudio = false,
  onHealth,
  onResumePosition,
}: {
  tile: Tile;
  command?: PlayerCommand;
  stopped?: boolean;
  overlayMode?: OverlayMode;
  focused?: boolean;
  activeAudio?: boolean;
  onHealth?: (health: PlayerHealth) => void;
  onResumePosition?: (tileId: string, sourceUrl: string, position: number) => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const adapter = useRef<Adapter | undefined>(undefined);
  const adapterReady = useRef(false);
  const pendingControls = useRef({ muted: tile.muted, volume: tile.volume });
  const pendingTransport = useRef<PlayerCommand | undefined>(undefined);
  const lastCommandId = useRef<string | undefined>(undefined);
  const retryTimer = useRef<number | undefined>(undefined);
  const retryAttempt = useRef(0);
  const lastReadyAt = useRef<number | undefined>(undefined);
  const sourceKey = `${tile.source.type}:${tile.source.url}`;
  const currentSourceKey = useRef(sourceKey);
  const [retryNonce, setRetryNonce] = useState(0);
  const [status, setStatus] = useState<PlayerHealthStatus>(stopped ? 'stopped' : 'loading');
  const [message, setMessage] = useState(
    stopped ? 'Players are stopped.' : 'Connecting to source…',
  );
  const [technicalDetail, setTechnicalDetail] = useState('');
  const [controlMessage, setControlMessage] = useState('');
  const messageTimer = useRef<number | undefined>(undefined);
  const latestName = useRef(tile.name);
  latestName.current = tile.name;

  const publish = useCallback(
    (
      nextStatus: PlayerHealthStatus,
      nextMessage?: string,
      detail?: string,
      retry?: number,
      nextRetryAt?: number,
    ) => {
      if (['ready', 'playing'].includes(nextStatus)) lastReadyAt.current = Date.now();
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
      });
    },
    [onHealth, tile.id, tile.source.url],
  );

  const reportControlFailure = useCallback((label: string) => {
    setControlMessage(`${label} could not be applied. The player is still connected.`);
    clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setControlMessage(''), 4_000);
  }, []);

  const runControl = useCallback(
    (label: string, action: (current: Adapter) => void) => {
      if (!adapter.current || !adapterReady.current) return false;
      try {
        action(adapter.current);
        return true;
      } catch {
        reportControlFailure(label);
        return false;
      }
    },
    [reportControlFailure],
  );

  const capturePosition = useCallback(() => {
    const position = adapter.current?.getPosition();
    if (typeof position === 'number' && Number.isFinite(position) && position >= 0) {
      onResumePosition?.(tile.id, tile.source.url, position);
    }
  }, [onResumePosition, tile.id, tile.source.url]);

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
      if (next.command === 'mute') pendingControls.current.muted = true;
      if (next.command === 'unmute') pendingControls.current.muted = false;
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
        if (!['volume', 'mute', 'unmute'].includes(next.command)) pendingTransport.current = next;
        return;
      }
      if (next.command === 'play' || next.command === 'resume')
        runControl('Play', (current) => current.play());
      if (next.command === 'pause') runControl('Pause', (current) => current.pause());
      if (next.command === 'seek') runControl('Seek', (current) => current.seek(next.value ?? 0));
      if (next.command === 'mute') runControl('Mute', (current) => current.setMuted(true));
      if (next.command === 'unmute') runControl('Unmute', (current) => current.setMuted(false));
      if (next.command === 'volume')
        runControl('Volume', (current) => current.setVolume(next.value ?? 0));
    },
    [runControl, stopPlayer, tile.source.type],
  );

  const applyPendingControls = useCallback(() => {
    runControl('Volume', (current) => current.setVolume(pendingControls.current.volume));
    runControl('Mute', (current) => current.setMuted(pendingControls.current.muted));
    if (tile.resumePosition && tile.resumePosition > 0) {
      runControl('Resume position', (current) => current.seek(tile.resumePosition!));
    }
    if (pendingTransport.current) {
      const next = pendingTransport.current;
      pendingTransport.current = undefined;
      runPlayerCommand(next);
    }
  }, [runControl, runPlayerCommand, tile.resumePosition]);

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
    }
  }, [sourceKey]);

  useEffect(() => {
    const node = mount.current;
    if (!node) return;
    let disposed = false;
    let timeout: number | undefined;
    adapterReady.current = false;
    pendingTransport.current = undefined;
    node.replaceChildren();
    if (stopped) {
      publish('stopped', 'Players are stopped. Resume All to reconnect.');
      return;
    }
    publish('loading', 'Connecting to source…');

    const ready = (nextStatus: PlayerHealthStatus = 'ready') => {
      retryAttempt.current = 0;
      adapterReady.current = true;
      applyPendingControls();
      publish(nextStatus, nextStatus === 'playing' ? 'Playing' : 'Ready');
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
      adapter.current = { ...emptyAdapter, getPosition: () => 0 };
      if (parameters.get('health') === 'recoverable' && retryAttempt.current < 1) {
        scheduleRetry('Test source disconnected.', 'mock:recoverable');
      } else if (parameters.get('health') === 'failed') {
        publish('failed', 'Test source failed.', 'mock:failed', 3);
      } else ready('playing');
    } else if (tile.source.type === 'youtube') {
      const playerNode = document.createElement('div');
      node.appendChild(playerNode);
      loadYouTube().then((YT) => {
        if (disposed) return;
        const player = new YT.Player(playerNode, {
          videoId: tile.source.youtubeId,
          playerVars: { autoplay: 1, mute: 1, playsinline: 1, rel: 0, origin: location.origin },
          events: {
            onReady: () => {
              if (disposed) return;
              ready();
              runControl('Play', (current) => current.play());
            },
            onStateChange: (event: { data: number }) => {
              const mapped: Record<number, PlayerHealthStatus> = {
                [-1]: 'loading',
                0: 'paused',
                1: 'playing',
                2: 'paused',
                3: 'buffering',
                5: 'ready',
              };
              publish(mapped[event.data] ?? 'unknown');
            },
            onError: (event: { data: number }) => {
              const friendly =
                event.data === 153
                  ? 'YouTube rejected the page referrer (Error 153).'
                  : 'YouTube could not play this video.';
              scheduleRetry(friendly, `youtube:${event.data}`);
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
          destroy: () => player.destroy(),
        };
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
        hls.loadSource(tile.source.url);
        hls.attachMedia(video);
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
        play: () => void video.play(),
        pause: () => video.pause(),
        seek: (seconds) => (video.currentTime = seconds),
        setMuted: (muted) => (video.muted = muted),
        setVolume: (volume) => (video.volume = volume / 100),
        getPosition: () => (Number.isFinite(video.currentTime) ? video.currentTime : undefined),
        destroy: () => {
          hls?.destroy();
          video.removeAttribute('src');
          video.load();
        },
      };
      adapterReady.current = true;
      applyPendingControls();
    } else {
      const frame = document.createElement('iframe');
      frame.src = tile.source.url;
      frame.allow = 'autoplay; fullscreen; picture-in-picture';
      frame.referrerPolicy = 'strict-origin-when-cross-origin';
      frame.title = latestName.current;
      frame.onload = () =>
        publish('unknown', 'Loaded; playback state is unavailable for this provider.');
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
    publish,
    retryNonce,
    runControl,
    scheduleRetry,
    stopped,
    tile.source.type,
    tile.source.url,
    tile.source.youtubeId,
  ]);

  useEffect(() => {
    pendingControls.current.muted = tile.muted;
    runControl('Mute', (current) => current.setMuted(tile.muted));
  }, [runControl, tile.muted]);
  useEffect(() => {
    pendingControls.current.volume = tile.volume;
    runControl('Volume', (current) => current.setVolume(tile.volume));
  }, [runControl, tile.volume]);
  useEffect(() => {
    if (
      !command ||
      (command.tileId !== tile.id && command.tileId !== '*') ||
      command.id === lastCommandId.current
    )
      return;
    lastCommandId.current = command.id;
    runPlayerCommand(command);
  }, [command, runPlayerCommand, tile.id]);
  useEffect(
    () => () => {
      clearTimeout(messageTimer.current);
      clearTimeout(retryTimer.current);
      capturePosition();
    },
    [capturePosition],
  );

  const showState = ['loading', 'retrying', 'stopped', 'failed', 'unsupported'].includes(status);
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
  destroy() {},
};
