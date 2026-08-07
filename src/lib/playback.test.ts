import { describe, expect, it } from 'vitest';
import {
  defaultStartBehavior,
  formatTimestamp,
  normalizePlaybackProgress,
  normalizePlaybackStart,
  parseTimestamp,
  resumeTarget,
} from './playback';
import { detectSource } from './sources';

describe('P3 playback normalization', () => {
  it.each([
    ['90', 90],
    ['1:25', 85],
    ['1:25:30', 5130],
    [75.8, 75],
  ])('parses %s', (value, expected) => expect(parseTimestamp(value)).toBe(expected));

  it.each(['', '-1', '1:70', '1:2:70', 'abc', null, undefined])(
    'rejects malformed timestamp %s',
    (value) => expect(parseTimestamp(value)).toBeUndefined(),
  );

  it('formats normalized timestamps', () => {
    expect(formatTimestamp(85)).toBe('1:25');
    expect(formatTimestamp(5130)).toBe('1:25:30');
  });

  it('restarts near the end and resumes otherwise', () => {
    expect(resumeTarget({ position: 90, duration: 100 })).toBe(0);
    expect(resumeTarget({ position: 70, duration: 100 })).toBe(70);
  });

  it('defaults live-looking sources to live edge and VOD to resume', () => {
    expect(defaultStartBehavior(detectSource('https://example.com/channel/live.m3u8'))).toEqual({
      behavior: 'live',
    });
    expect(defaultStartBehavior(detectSource('https://youtu.be/dQw4w9WgXcQ'))).toEqual({
      behavior: 'resume',
    });
  });

  it('normalizes null, partial, and malformed playback data', () => {
    const source = detectSource('https://youtu.be/dQw4w9WgXcQ');
    expect(normalizePlaybackStart(null, source)).toEqual({ behavior: 'resume' });
    expect(normalizePlaybackStart({ behavior: 'specific', specificTime: '2:03' }, source)).toEqual({
      behavior: 'specific',
      specificTime: 123,
    });
    expect(normalizePlaybackStart({ behavior: 'specific', specificTime: 'bad' }, source)).toEqual({
      behavior: 'beginning',
    });
  });

  it('deduplicates and sanitizes progress records', () => {
    expect(
      normalizePlaybackProgress({
        entries: [
          { key: 'one', position: 10, duration: 100, playlistIndex: 2, updatedAt: 1 },
          { key: 'one', position: 20 },
          { key: 'bad', position: -1 },
        ],
      }).entries,
    ).toEqual([{ key: 'one', position: 10, duration: 100, playlistIndex: 2, updatedAt: 1 }]);
  });
});
