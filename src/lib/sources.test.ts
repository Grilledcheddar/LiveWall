import { describe, expect, it } from 'vitest';
import { detectSource, parseYouTubeId } from './sources';

describe('YouTube URL parsing', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?t=3', 'dQw4w9WgXcQ'],
    ['https://youtube.com/live/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('parses %s', (url, id) => expect(parseYouTubeId(url)).toBe(id));
  it('rejects lookalike hosts', () =>
    expect(parseYouTubeId('https://youtube.com.example/watch?v=dQw4w9WgXcQ')).toBeUndefined());
});

describe('source detection', () => {
  it('detects HLS case-insensitively', () =>
    expect(detectSource('https://cdn.example/live.M3U8?token=x').type).toBe('hls'));
  it('detects generic websites', () =>
    expect(detectSource('https://example.com/page').type).toBe('website'));
  it('rejects executable protocols', () =>
    expect(() => detectSource('javascript:alert(1)')).toThrow(/Only http/));
});
