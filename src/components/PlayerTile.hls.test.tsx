import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTile } from '../lib/state';
import { PlayerTile } from './PlayerTile';

const harness = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock('hls.js', () => {
  class MockHls {
    static Events = { MANIFEST_PARSED: 'manifest', LEVEL_SWITCHED: 'level', ERROR: 'error' };
    static isSupported = () => true;
    handlers = new Map<string, (...args: any[]) => void>();
    levels = [
      { height: 360, bitrate: 800_000 },
      { height: 720, bitrate: 2_500_000 },
    ];
    currentLevel = -1;
    nextLevel = -1;
    constructor() {
      harness.instances.push(this);
    }
    loadSource() {}
    attachMedia() {}
    on(event: string, handler: (...args: any[]) => void) {
      this.handlers.set(event, handler);
    }
    destroy() {}
  }
  return { default: MockHls };
});

afterEach(() => {
  cleanup();
  harness.instances.length = 0;
});

describe('PlayerTile HLS quality', () => {
  it('uses next-segment switching and does not remount when quality changes', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    const tile = newTile('HLS', { type: 'hls', url: 'https://example.com/live.m3u8' });
    const view = render(<PlayerTile tile={tile} qualityPreference={{ mode: 'auto' }} />);
    const video = view.container.querySelector('video');
    const hls = harness.instances[0];
    act(() => hls.handlers.get('manifest')?.());
    expect(hls.nextLevel).toBe(-1);
    view.rerender(
      <PlayerTile
        tile={tile}
        qualityPreference={{ mode: 'level', height: 720, bitrate: 2_500_000 }}
      />,
    );
    expect(harness.instances).toHaveLength(1);
    expect(view.container.querySelector('video')).toBe(video);
    expect(hls.nextLevel).toBe(1);
  });
});
