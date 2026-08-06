import type { VideoSource } from './types.js';

export function fallbackTitle(source: VideoSource): string {
  if (source.type === 'youtube') return 'YouTube video';
  try {
    const hostname = new URL(source.url).hostname.replace(/^www\./, '');
    return hostname || (source.type === 'hls' ? 'HLS stream' : 'Video source');
  } catch {
    return source.type === 'hls' ? 'HLS stream' : 'Video source';
  }
}

export async function resolveYouTubeTitle(url: string): Promise<string> {
  const response = await fetch(`/api/youtube-title?url=${encodeURIComponent(url)}`);
  if (!response.ok) throw new Error('Automatic title unavailable. You can still use this source.');
  const payload = (await response.json()) as { title?: unknown };
  if (typeof payload.title !== 'string' || !payload.title.trim()) {
    throw new Error('Automatic title unavailable. You can still use this source.');
  }
  return payload.title.trim().slice(0, 160);
}

export async function finalizeTitle(
  source: VideoSource,
  mode: 'auto' | 'manual',
  currentTitle: string,
  resolver: (url: string) => Promise<string> = resolveYouTubeTitle,
): Promise<string> {
  const manual = currentTitle.trim().slice(0, 160);
  if (manual) return manual;
  if (mode === 'auto' && source.type === 'youtube') {
    try {
      return await resolver(source.url);
    } catch {
      return 'YouTube video';
    }
  }
  return fallbackTitle(source);
}
