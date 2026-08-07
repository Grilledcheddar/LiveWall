import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import legacyState from '../test/fixtures/legacy-pre-p1.json';
import { useWall } from './useWall';

class FakeBroadcastChannel {
  onmessage?: (event: MessageEvent) => void;
  postMessage() {}
  close() {}
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  constructor() {
    FakeWebSocket.instances.push(this);
  }
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: MessageEvent) => void;
  close() {}
}

describe('useWall state ingress', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('normalizes legacy HTTP state before exposing it to either route', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => structuredClone(legacyState) }),
    );
    const { result } = renderHook(() => useWall());
    await waitFor(() => expect(result.current.state.tiles).toHaveLength(2));
    expect(result.current.state.appearance.backgroundColor).toBe('#020305');
    expect(result.current.state.overlayMode).toBe('hover');
    expect(result.current.state.tiles.map((tile) => tile.displayOrder)).toEqual([0, 1]);
  });

  it('keeps the last safe state and reports malformed incoming data', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tiles: null }) }),
    );
    const { result } = renderHook(() => useWall());
    await waitFor(() => expect(result.current.stateError).toContain('could not be loaded safely'));
    expect(result.current.state.tiles).toEqual([]);
    expect(result.current.state.appearance.backgroundColor).toBe('#020305');
  });

  it('delivers every rapid player command to the Wall in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => structuredClone(legacyState) }),
    );
    const { result } = renderHook(() => {
      const wall = useWall();
      return wall;
    });
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    const socket = FakeWebSocket.instances[0];
    act(() => {
      for (const id of ['mute-one', 'unmute-two', 'pause-two', 'play-two']) {
        socket.onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify({
              type: 'command',
              command: { id, tileId: 'tile', command: id.split('-')[0], sentAt: 1 },
            }),
          }),
        );
      }
    });
    await waitFor(() =>
      expect(result.current.commands.map((command) => command.id)).toEqual([
        'mute-one',
        'unmute-two',
        'pause-two',
        'play-two',
      ]),
    );
  });
});
