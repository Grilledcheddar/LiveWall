import { describe, expect, it } from 'vitest';
import {
  calculateSplitGeometry,
  externalViewModes,
  type DesktopRect,
  type SplitRatio,
} from './split-view';

const monitor: DesktopRect = { x: -720, y: -2160, width: 3840, height: 2080 };

describe('External Split View geometry', () => {
  it.each(
    externalViewModes.flatMap((mode) =>
      ([65, 60, 50] as SplitRatio[]).map((ratio) => [mode, ratio] as const),
    ),
  )('keeps %s at %i%% on-screen without gaps or overlap', (mode, ratio) => {
    const result = calculateSplitGeometry(monitor, mode, ratio);
    expect(result.external.x).toBeGreaterThanOrEqual(monitor.x);
    expect(result.external.y).toBeGreaterThanOrEqual(monitor.y);
    expect(result.external.x + result.external.width).toBeLessThanOrEqual(
      monitor.x + monitor.width,
    );
    expect(result.external.y + result.external.height).toBeLessThanOrEqual(
      monitor.y + monitor.height,
    );
    if (result.wall && mode !== 'overlay') {
      const overlap =
        result.wall.x < result.external.x + result.external.width &&
        result.wall.x + result.wall.width > result.external.x &&
        result.wall.y < result.external.y + result.external.height &&
        result.wall.y + result.wall.height > result.external.y;
      expect(overlap).toBe(false);
    }
  });

  it('preserves negative monitor coordinates for all directional arrangements', () => {
    expect(calculateSplitGeometry(monitor, 'wall-top', 65).wall?.y).toBe(monitor.y);
    expect(calculateSplitGeometry(monitor, 'external-top', 65).external.y).toBe(monitor.y);
    expect(calculateSplitGeometry(monitor, 'external-left', 65).external.x).toBe(monitor.x);
    expect(calculateSplitGeometry(monitor, 'wall-left', 65).wall?.x).toBe(monitor.x);
  });
});
