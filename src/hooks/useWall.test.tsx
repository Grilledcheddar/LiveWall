import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import legacyState from '../test/fixtures/legacy-pre-p1.json';
import { useWall } from './useWall';

class FakeBroadcastChannel {
  onmessage?: (event: MessageEvent) => void;
  postMessage() {}
  close() {}
}

class FakeWebSocket {
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: MessageEvent) => void;
  close() {}
}

describe('useWall state ingress', () => {
  beforeEach(() => {
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
});
