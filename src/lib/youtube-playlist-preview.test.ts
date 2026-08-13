import { describe, expect, it, vi } from 'vitest';
import { previewYouTubePlaylist } from './youtube-playlist-preview';

describe('YouTube playlist preview', () => {
  it('enumerates ordered entries in a disposable hidden player', async () => {
    const destroy = vi.fn();
    window.YT = {
      Player: function (_node: HTMLElement, options: any) {
        const player = {
          loadPlaylist: vi.fn(),
          getPlaylist: () => ['first123', 'second456'],
          destroy,
        };
        queueMicrotask(() => options.events.onReady());
        return player;
      },
    };
    const preview = await previewYouTubePlaylist(
      'https://www.youtube.com/playlist?list=PL1234567890',
    );
    expect(preview.entries.map((entry) => entry.source.youtubeId)).toEqual([
      'first123',
      'second456',
    ]);
    expect(destroy).toHaveBeenCalledOnce();
    expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
