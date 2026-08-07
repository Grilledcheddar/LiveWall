import { describe, expect, it } from 'vitest';
import {
  hlsQualityLabel,
  normalizeQualityPreference,
  normalizeQualityPreferences,
  resolveHlsQualityLevel,
} from './quality';

const levels = [
  { index: 0, height: 360, bitrate: 800_000 },
  { index: 1, height: 720, bitrate: 2_500_000 },
  { index: 2, height: 720, bitrate: 4_000_000 },
];

describe('capability-aware quality preferences', () => {
  it('normalizes malformed preferences to Auto', () => {
    expect(normalizeQualityPreference(null)).toEqual({ mode: 'auto' });
    expect(normalizeQualityPreference({ mode: 'level', height: -1 })).toEqual({ mode: 'auto' });
    expect(normalizeQualityPreferences({ source: { mode: 'level', height: 720 } })).toEqual({
      source: { mode: 'level', height: 720 },
    });
  });

  it('matches a supported HLS level and safely falls back when it disappears', () => {
    expect(
      resolveHlsQualityLevel(levels, { mode: 'level', height: 720, bitrate: 4_000_000 }),
    ).toEqual({ index: 2, fallback: false });
    expect(resolveHlsQualityLevel(levels, { mode: 'level', height: 1080 })).toEqual({
      index: -1,
      fallback: true,
    });
  });

  it('includes bitrate so duplicate resolutions remain distinguishable', () => {
    expect(hlsQualityLabel(levels[1])).toBe('720p · 2.5 Mbps');
    expect(hlsQualityLabel(levels[2])).toBe('720p · 4.0 Mbps');
  });
});
