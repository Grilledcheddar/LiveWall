import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyState, normalizeWallState } from '../lib/state';
import type {
  LayoutTemplateFile,
  PlaybackProgressFile,
  PlayerCommand,
  PlayerHealth,
  ServerMessage,
  SourceLibrary,
  WallState,
  WallPresetFile,
} from '../lib/types';
import { normalizePlaybackProgress } from '../lib/playback';
import { normalizeLayoutTemplates } from '../lib/layouts';
import { normalizeWallPresets } from '../lib/walls';

const channelName = 'livewall-sync-v1';

export function useWall() {
  const [state, setState] = useState<WallState>(emptyState);
  const stateRef = useRef<WallState>(state);
  const [connected, setConnected] = useState(false);
  const [lastCommand, setLastCommand] = useState<PlayerCommand>();
  const [healthByTile, setHealthByTile] = useState<Record<string, PlayerHealth>>({});
  const [stateError, setStateError] = useState('');
  const [progress, setProgress] = useState<PlaybackProgressFile>(() =>
    normalizePlaybackProgress(undefined),
  );
  const [templates, setTemplates] = useState<LayoutTemplateFile>(() =>
    normalizeLayoutTemplates(undefined),
  );
  const [presets, setPresets] = useState<WallPresetFile>(() => normalizeWallPresets(undefined));
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const acceptState = useCallback((next: unknown) => {
    try {
      const normalized = normalizeWallState(next);
      stateRef.current = normalized;
      setState(normalized);
      setStateError('');
      return normalized;
    } catch {
      setStateError(
        'Saved wall data could not be loaded safely. Restore the latest backup and restart LiveWall.',
      );
      return undefined;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bc = new BroadcastChannel(channelName);
    channel.current = bc;
    bc.onmessage = (event: MessageEvent<ServerMessage>) => {
      if (event.data.type === 'state' || event.data.type === 'hello') acceptState(event.data.state);
      if (event.data.type === 'command') setLastCommand(event.data.command);
      if (event.data.type === 'health') {
        const health = event.data.health;
        setHealthByTile((current) => ({ ...current, [health.tileId]: health }));
      }
      if (event.data.type === 'error') setStateError(event.data.message);
    };
    fetch('/api/state')
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Saved wall data could not be loaded.');
        return body;
      })
      .then((fresh) => active && acceptState(fresh))
      .catch(
        (error) =>
          active &&
          setStateError(
            error instanceof Error ? error.message : 'Saved wall data could not be loaded.',
          ),
      );
    void Promise.all([
      fetch('/api/playback-progress').then((response) => response.json()),
      fetch('/api/layout-templates').then((response) => response.json()),
      fetch('/api/wall-presets').then((response) => response.json()),
    ])
      .then(([nextProgress, nextTemplates, nextPresets]) => {
        if (!active) return;
        setProgress(normalizePlaybackProgress(nextProgress));
        setTemplates(normalizeLayoutTemplates(nextTemplates));
        setPresets(normalizeWallPresets(nextPresets));
      })
      .catch(() => active && setStateError('P3 workspace data could not be loaded safely.'));

    let socket: WebSocket;
    let retry: number;
    const connect = () => {
      socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
      );
      socket.onopen = () => active && setConnected(true);
      socket.onclose = () => {
        if (!active) return;
        setConnected(false);
        retry = window.setTimeout(connect, 1200);
      };
      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data) as ServerMessage;
        } catch {
          setStateError(
            'The Wall received an invalid server message and kept its last safe state.',
          );
          return;
        }
        if (message.type === 'state' || message.type === 'hello') {
          acceptState(message.state);
          bc.postMessage(message);
        } else if (message.type === 'command') {
          setLastCommand(message.command);
          bc.postMessage(message);
        } else if (message.type === 'health') {
          setHealthByTile((current) => ({ ...current, [message.health.tileId]: message.health }));
          bc.postMessage(message);
        } else {
          setStateError(message.message);
        }
      };
    };
    connect();
    return () => {
      active = false;
      clearTimeout(retry);
      socket?.close();
      bc.close();
    };
  }, [acceptState]);

  const save = useCallback(
    async (next: WallState | ((current: WallState) => WallState)) => {
      const submitted = normalizeWallState(
        typeof next === 'function' ? next(stateRef.current) : next,
      );
      acceptState(submitted);
      const response = await fetch('/api/state', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(submitted),
      });
      if (!response.ok) throw new Error('The wall configuration could not be saved.');
      const saved = normalizeWallState(await response.json());
      acceptState(saved);
      channel.current?.postMessage({ type: 'state', state: saved } satisfies ServerMessage);
      return saved;
    },
    [acceptState],
  );

  const command = useCallback(
    async (tileId: string, name: PlayerCommand['command'], value?: number) => {
      const next: PlayerCommand = {
        id: crypto.randomUUID(),
        tileId,
        command: name,
        value,
        sentAt: Date.now(),
      };
      channel.current?.postMessage({ type: 'command', command: next } satisfies ServerMessage);
      await fetch('/api/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
    },
    [],
  );

  const saveLibrary = useCallback(
    async (library: SourceLibrary) => {
      const response = await fetch('/api/library', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ library, expectedVersion: stateRef.current.version }),
      });
      const body = await response.json();
      if (!response.ok) {
        if (body.state) acceptState(body.state);
        throw new Error(body.message || 'The Source Library could not be saved.');
      }
      return acceptState(body)!;
    },
    [acceptState],
  );

  const importLibrary = useCallback(
    async (payload: unknown) => {
      const response = await fetch('/api/library/import', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.message || 'The Source Library could not be imported.');
      acceptState(body.state);
      return body as { state: WallState; backupPath: string };
    },
    [acceptState],
  );

  const reportHealth = useCallback((health: PlayerHealth) => {
    setHealthByTile((current) => ({ ...current, [health.tileId]: health }));
    channel.current?.postMessage({ type: 'health', health } satisfies ServerMessage);
    void fetch('/api/player-health', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(health),
    });
  }, []);

  const reportPlaybackProgress = useCallback(
    async (sourceUrl: string, position: number, duration?: number, playlistIndex?: number) => {
      const response = await fetch('/api/playback-progress', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceUrl, position, duration, playlistIndex }),
      });
      if (response.ok) setProgress(normalizePlaybackProgress(await response.json()));
    },
    [],
  );

  const clearPlaybackProgress = useCallback(async (sourceUrl: string) => {
    const response = await fetch(
      `/api/playback-progress?sourceUrl=${encodeURIComponent(sourceUrl)}`,
      {
        method: 'DELETE',
      },
    );
    if (!response.ok) throw new Error('Saved playback position could not be cleared.');
    setProgress(normalizePlaybackProgress(await response.json()));
  }, []);

  const saveTemplates = useCallback(async (next: LayoutTemplateFile) => {
    const response = await fetch('/api/layout-templates', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!response.ok) throw new Error('Layout templates could not be saved.');
    const normalized = normalizeLayoutTemplates(await response.json());
    setTemplates(normalized);
    return normalized;
  }, []);

  const savePresets = useCallback(async (next: WallPresetFile) => {
    const response = await fetch('/api/wall-presets', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!response.ok) throw new Error('Wall presets could not be saved.');
    const normalized = normalizeWallPresets(await response.json());
    setPresets(normalized);
    return normalized;
  }, []);

  return {
    state,
    save,
    connected,
    command,
    lastCommand,
    healthByTile,
    reportHealth,
    progress,
    templates,
    presets,
    reportPlaybackProgress,
    clearPlaybackProgress,
    saveTemplates,
    savePresets,
    stateError,
    saveLibrary,
    importLibrary,
  };
}
