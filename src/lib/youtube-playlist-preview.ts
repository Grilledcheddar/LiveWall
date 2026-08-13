import { detectSource } from './sources.js';
import type { PlaybackStart, QueueEntry, VideoSource } from './types.js';

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiReady: Promise<any> | undefined;

function loadIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiReady) {
    apiReady = new Promise((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      const timeout = window.setTimeout(
        () => reject(new Error('YouTube did not make its playlist API ready.')),
        10_000,
      );
      window.onYouTubeIframeAPIReady = () => {
        clearTimeout(timeout);
        previous?.();
        resolve(window.YT);
      };
      if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.onerror = () =>
          reject(new Error('YouTube playlist preview could not load its API.'));
        document.head.appendChild(script);
      }
    }).catch((error) => {
      apiReady = undefined;
      throw error;
    });
  }
  return apiReady;
}

export interface PlaylistPreview {
  playlistId: string;
  entries: QueueEntry[];
}

/** Creates a hidden, disposable API player; it never reads or writes Wall state. */
export async function previewYouTubePlaylist(
  rawUrl: string,
  playback: PlaybackStart = { behavior: 'resume' },
): Promise<PlaylistPreview> {
  const playlist = detectSource(rawUrl);
  if (playlist.type !== 'youtube-playlist' || !playlist.playlistId)
    throw new Error('Enter a YouTube playlist URL.');
  const YT = await loadIframeApi();
  const node = document.createElement('div');
  node.setAttribute('aria-hidden', 'true');
  node.style.cssText =
    'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;overflow:hidden;';
  document.body.appendChild(node);
  let player: any;
  try {
    const ids = await new Promise<string[]>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('YouTube could not enumerate this playlist.')),
        12_000,
      );
      player = new YT.Player(node, {
        height: '1',
        width: '1',
        playerVars: {
          listType: 'playlist',
          list: playlist.playlistId,
          playsinline: 1,
          origin: location.origin,
        },
        events: {
          onReady: () => {
            player.loadPlaylist({ listType: 'playlist', list: playlist.playlistId });
            window.setTimeout(() => {
              const list = player.getPlaylist?.() as string[] | undefined;
              clearTimeout(timeout);
              if (list?.length) resolve(list);
              else reject(new Error('YouTube returned no playable entries for this playlist.'));
            }, 300);
          },
          onError: () => {
            clearTimeout(timeout);
            reject(new Error('YouTube could not enumerate this playlist.'));
          },
        },
      });
    });
    return {
      playlistId: playlist.playlistId,
      entries: ids.map((youtubeId) => ({
        id: crypto.randomUUID(),
        source: detectSource(`https://www.youtube.com/watch?v=${youtubeId}`) as VideoSource,
        playback,
        title: `YouTube video ${youtubeId}`,
        titleMode: 'auto',
        status: 'ready',
      })),
    };
  } finally {
    player?.destroy?.();
    node.remove();
  }
}
