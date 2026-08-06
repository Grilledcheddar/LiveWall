import { detectSource } from '../src/lib/sources.js';

export function sanitizeTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = Array.from(value)
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? ' ' : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned ? cleaned.slice(0, 160) : undefined;
}

export async function fetchYouTubeTitle(
  videoUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const source = detectSource(videoUrl);
  if (source.type !== 'youtube')
    throw new Error('Automatic titles are available for YouTube sources.');
  const endpoint = new URL('https://www.youtube.com/oembed');
  endpoint.searchParams.set('url', source.url);
  endpoint.searchParams.set('format', 'json');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetcher(endpoint, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('YouTube did not return a title.');
    const title = sanitizeTitle(((await response.json()) as { title?: unknown }).title);
    if (!title) throw new Error('YouTube returned an invalid title.');
    return title;
  } finally {
    clearTimeout(timeout);
  }
}
