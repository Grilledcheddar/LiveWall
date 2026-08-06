import { describe, expect, it, vi } from 'vitest';
import { finalizeTitle } from './titles';

const youtube = {
  type: 'youtube' as const,
  url: 'https://www.youtube.com/watch?v=rqHW2HhgGQ0',
  youtubeId: 'rqHW2HhgGQ0',
};

describe('title choices', () => {
  it('uses automatic YouTube metadata when requested', async () => {
    await expect(finalizeTitle(youtube, 'auto', '', async () => 'Bear Cam')).resolves.toBe(
      'Bear Cam',
    );
  });

  it('keeps a manual override without calling automatic metadata', async () => {
    const resolver = vi.fn().mockResolvedValue('Ignored');
    await expect(finalizeTitle(youtube, 'manual', 'My title', resolver)).resolves.toBe('My title');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('does not block a source when title lookup fails', async () => {
    await expect(
      finalizeTitle(youtube, 'auto', '', async () => {
        throw new Error('offline');
      }),
    ).resolves.toBe('YouTube video');
  });
});
