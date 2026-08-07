import type { VideoSource } from './types.js';

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

export function parseYouTubeId(input: string): string | undefined {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return undefined;
    let id: string | null | undefined;
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0];
    else if (url.pathname === '/watch') id = url.searchParams.get('v');
    else {
      const parts = url.pathname.split('/').filter(Boolean);
      if (['embed', 'live', 'shorts'].includes(parts[0])) id = parts[1];
    }
    return id && /^[A-Za-z0-9_-]{6,15}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function parseYouTubePlaylistId(input: string): string | undefined {
  const trimmed = input.trim();
  if (/^[A-Za-z0-9_-]{10,80}$/.test(trimmed) && /^(?:PL|UU|LL|FL|RD|OLAK5uy_)/.test(trimmed))
    return trimmed;
  try {
    const url = new URL(trimmed);
    if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return undefined;
    const id = url.searchParams.get('list');
    return id && /^[A-Za-z0-9_-]{10,80}$/.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}

export function detectSource(input: string): VideoSource {
  const rawPlaylistId = parseYouTubePlaylistId(input);
  if (rawPlaylistId && !/^https?:/i.test(input.trim()))
    return {
      url: `https://www.youtube.com/playlist?list=${rawPlaylistId}`,
      type: 'youtube-playlist',
      playlistId: rawPlaylistId,
    };
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Enter a complete URL beginning with http:// or https://.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only http:// and https:// sources are supported.');
  }
  const normalized = url.toString();
  if (url.hostname === 'mock.livewall.local') return { url: normalized, type: 'mock' };
  const playlistId = parseYouTubePlaylistId(normalized);
  if (playlistId)
    return {
      url: `https://www.youtube.com/playlist?list=${playlistId}`,
      type: 'youtube-playlist',
      playlistId,
    };
  const youtubeId = parseYouTubeId(normalized);
  if (youtubeId) return { url: normalized, type: 'youtube', youtubeId };
  if (/\.m3u8(?:$|[?#])/i.test(normalized)) return { url: normalized, type: 'hls' };
  return { url: normalized, type: 'website' };
}

export function canonicalSourceUrl(source: VideoSource): string {
  if (source.type === 'youtube' && source.youtubeId) {
    return `https://www.youtube.com/watch?v=${source.youtubeId}`;
  }
  if (source.type === 'youtube-playlist' && source.playlistId) {
    return `https://www.youtube.com/playlist?list=${source.playlistId}`;
  }
  const url = new URL(source.url);
  url.hash = '';
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}
