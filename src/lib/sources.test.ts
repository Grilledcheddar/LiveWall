import { describe, expect, it } from 'vitest';
import {
  canonicalSourceUrl,
  detectSource,
  parseYouTubeId,
  parseYouTubePlaylist,
  parseYouTubePlaylistId,
} from './sources';

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

describe('YouTube playlist parsing', () => {
  const id = 'PL1234567890abcdef';
  it.each([
    [`https://www.youtube.com/playlist?list=${id}`, id],
    [`https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${id}`, id],
    [`https://youtu.be/dQw4w9WgXcQ?list=${id}`, id],
    [id, id],
  ])('parses %s', (value, expected) => expect(parseYouTubePlaylistId(value)).toBe(expected));

  it('detects and canonicalizes playlists as a distinct source type', () => {
    const source = detectSource(`https://youtube.com/watch?v=dQw4w9WgXcQ&list=${id}&index=2`);
    expect(source).toMatchObject({
      type: 'youtube-playlist',
      playlistId: id,
      playlistStartVideoId: 'dQw4w9WgXcQ',
      playlistStartIndex: 1,
    });
    expect(canonicalSourceUrl(source)).toBe(`https://www.youtube.com/playlist?list=${id}`);
  });

  it('retains an optional starting video and zero-based starting index', () => {
    expect(parseYouTubePlaylist(`https://youtu.be/dQw4w9WgXcQ?list=${id}&index=4`)).toEqual({
      playlistId: id,
      startingVideoId: 'dQw4w9WgXcQ',
      startingIndex: 3,
    });
  });
});

describe('source detection', () => {
  it('detects HLS case-insensitively', () =>
    expect(detectSource('https://cdn.example/live.M3U8?token=x').type).toBe('hls'));
  it('detects generic websites', () =>
    expect(detectSource('https://example.com/page').type).toBe('website'));
  it('rejects executable protocols', () =>
    expect(() => detectSource('javascript:alert(1)')).toThrow(/Only http/));
});
