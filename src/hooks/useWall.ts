import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyState, normalizeWallState } from '../lib/state';
import type {
  PlayerCommand,
  PlayerHealth,
  ServerMessage,
  SourceLibrary,
  WallState,
} from '../lib/types';

const channelName = 'livewall-sync-v1';

export function useWall() {
  const [state, setState] = useState<WallState>(emptyState);
  const stateRef = useRef<WallState>(state);
  const [connected, setConnected] = useState(false);
  const [lastCommand, setLastCommand] = useState<PlayerCommand>();
  const [healthByTile, setHealthByTile] = useState<Record<string, PlayerHealth>>({});
  const [stateError, setStateError] = useState('');
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

  const reportResumePosition = useCallback(
    async (tileId: string, sourceUrl: string, position: number) => {
      const response = await fetch('/api/resume-position', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tileId, sourceUrl, position }),
      });
      if (response.ok) acceptState(await response.json());
    },
    [acceptState],
  );

  return {
    state,
    save,
    connected,
    command,
    lastCommand,
    healthByTile,
    reportHealth,
    reportResumePosition,
    stateError,
    saveLibrary,
    importLibrary,
  };
}
