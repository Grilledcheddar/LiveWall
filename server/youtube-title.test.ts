// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fetchYouTubeTitle, sanitizeTitle } from './youtube-title';

describe('YouTube oEmbed title lookup', () => {
  it('returns sanitized mocked metadata', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ title: '  Live\u0000  Bears   Now  ' }), { status: 200 }),
      );
    await expect(
      fetchYouTubeTitle('https://www.youtube.com/watch?v=rqHW2HhgGQ0', fetcher),
    ).resolves.toBe('Live Bears Now');
  });

  it('rejects invalid metadata', () => expect(sanitizeTitle({ unsafe: true })).toBeUndefined());
});
