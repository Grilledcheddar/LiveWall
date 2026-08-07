import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { newTile } from '../lib/state';
import type { PlaybackProgress, PlayerCommand, PlayerHealth } from '../lib/types';
import { PlayerTile } from './PlayerTile';

const source = (label: string) => ({
  type: 'mock' as const,
  url: `https://mock.livewall.local/?label=${label}`,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.YT;
});

describe('PlayerTile lifecycle', () => {
  it('contains none of the unsupported YouTube quality APIs', () => {
    const sourceCode = readFileSync('src/components/PlayerTile.tsx', 'utf8');
    for (const unsupported of [
      'getPlaybackQuality',
      'setPlaybackQuality',
      'getAvailableQualityLevels',
      'suggestedQuality',
    ])
      expect(sourceCode).not.toContain(unsupported);
  });

  it('does not remount the target or unrelated player for metadata and volume changes', () => {
    const first = newTile('First', source('first'));
    const second = newTile('Second', source('second'));
    const view = render(
      <>
        <PlayerTile tile={first} />
        <PlayerTile tile={second} />
      </>,
    );
    const before = Array.from(view.container.querySelectorAll('.mock-player'));
    const changed = {
      ...first,
      name: 'Renamed',
      volume: 18,
      muted: false,
      queuedSource: source('queued'),
    };
    view.rerender(
      <>
        <PlayerTile tile={changed} />
        <PlayerTile tile={second} />
      </>,
    );
    const after = Array.from(view.container.querySelectorAll('.mock-player'));
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it('survives repeated rapid volume commands without recreating its player', () => {
    const tile = newTile('Rapid', source('rapid'));
    const view = render(<PlayerTile tile={tile} />);
    const player = view.container.querySelector('.mock-player');
    for (let value = 5; value <= 95; value += 10) {
      const command: PlayerCommand = {
        id: `volume-${value}`,
        tileId: tile.id,
        command: 'volume',
        value,
        sentAt: value,
      };
      view.rerender(<PlayerTile tile={{ ...tile, volume: value }} command={command} />);
    }
    expect(view.container.querySelector('.mock-player')).toBe(player);
    expect(view.container.querySelector('.player-tile')).toBeVisible();
  });

  it('switches active audio without pausing, seeking, or remounting either player', () => {
    const first = { ...newTile('First', source('first&position=17')), muted: true };
    const second = { ...newTile('Second', source('second&position=29')), muted: true };
    const view = render(
      <>
        <PlayerTile tile={first} />
        <PlayerTile tile={second} />
      </>,
    );
    const players = Array.from(view.container.querySelectorAll('.mock-player')) as HTMLElement[];
    const positions = players.map((player) => player.dataset.position);
    const renderCommand = (
      firstTile: typeof first,
      secondTile: typeof second,
      command: PlayerCommand,
    ) =>
      view.rerender(
        <>
          <PlayerTile tile={firstTile} command={command} />
          <PlayerTile tile={secondTile} command={command} />
        </>,
      );
    const activeFirst = { ...first, muted: false };
    renderCommand(activeFirst, second, {
      id: 'unmute-first',
      tileId: first.id,
      command: 'unmute',
      sentAt: 1,
    });
    renderCommand(activeFirst, second, {
      id: 'pause-first',
      tileId: first.id,
      command: 'pause',
      sentAt: 2,
    });
    expect(players[0].dataset.playing).toBe('false');
    renderCommand(activeFirst, second, {
      id: 'play-first',
      tileId: first.id,
      command: 'play',
      sentAt: 3,
    });
    expect(players[0].dataset.playing).toBe('true');
    const activeSecond = { ...second, muted: false };
    renderCommand(first, activeSecond, {
      id: 'mute-first',
      tileId: first.id,
      command: 'mute',
      sentAt: 4,
    });
    renderCommand(first, activeSecond, {
      id: 'unmute-second',
      tileId: second.id,
      command: 'unmute',
      sentAt: 5,
    });
    const after = Array.from(view.container.querySelectorAll('.mock-player')) as HTMLElement[];
    expect(after).toEqual(players);
    expect(after[0].dataset.playing).toBe('true');
    expect(after[1].dataset.playing).toBe('true');
    expect(after.map((player) => player.dataset.position)).toEqual(positions);
    expect(after[0].dataset.muted).toBe('true');
    expect(after[1].dataset.muted).toBe('false');
  });

  it('unloads on Stop All and intentionally remounts on resume', () => {
    const tile = newTile('Stop', source('stop'));
    const onResumePosition = vi.fn();
    const view = render(<PlayerTile tile={tile} onResumePosition={onResumePosition} />);
    const before = view.container.querySelector('.mock-player');
    const stop: PlayerCommand = {
      id: 'stop-all',
      tileId: '*',
      command: 'stop',
      sentAt: 1,
    };
    view.rerender(<PlayerTile tile={tile} command={stop} onResumePosition={onResumePosition} />);
    view.rerender(
      <PlayerTile tile={tile} command={stop} stopped onResumePosition={onResumePosition} />,
    );
    expect(view.container.querySelector('.mock-player')).toBeNull();
    expect(view.container.querySelector('[data-health="stopped"]')).toBeVisible();
    expect(onResumePosition).toHaveBeenCalledWith(tile.id, tile.source.url, 0);
    view.rerender(<PlayerTile tile={tile} onResumePosition={onResumePosition} />);
    expect(view.container.querySelector('.mock-player')).not.toBe(before);
  });

  it('keeps every player mounted while focus and overlay modes change', () => {
    const tile = newTile('Focus', source('focus'));
    const view = render(<PlayerTile tile={tile} overlayMode="hover" />);
    const player = view.container.querySelector('.mock-player');
    view.rerender(<PlayerTile tile={tile} overlayMode="always" focused />);
    expect(view.container.querySelector('.mock-player')).toBe(player);
    expect(view.container.querySelector('.player-tile')).toHaveClass(
      'overlay-always',
      'is-focused',
    );
  });

  it('does not remount when durable playback progress changes', () => {
    const tile = newTile('Progress', source('progress&duration=300'));
    const first: PlaybackProgress = {
      key: tile.source.url,
      position: 40,
      duration: 300,
      updatedAt: 1,
    };
    const view = render(<PlayerTile tile={tile} progress={first} />);
    const player = view.container.querySelector('.mock-player');
    view.rerender(<PlayerTile tile={tile} progress={{ ...first, position: 55, updatedAt: 2 }} />);
    expect(view.container.querySelector('.mock-player')).toBe(player);
  });

  it('applies a specific start time and saves progress on pause', () => {
    const tile = {
      ...newTile('VOD', source('vod&duration=300')),
      playback: { behavior: 'specific' as const, specificTime: 85 },
    };
    const onPlaybackProgress = vi.fn();
    const view = render(<PlayerTile tile={tile} onPlaybackProgress={onPlaybackProgress} />);
    view.rerender(
      <PlayerTile
        tile={tile}
        onPlaybackProgress={onPlaybackProgress}
        command={{ id: 'pause', tileId: tile.id, command: 'pause', sentAt: 1 }}
      />,
    );
    expect(onPlaybackProgress).toHaveBeenCalledWith(tile.source.url, 85, 300, undefined);
  });

  it('sends live mocks to the live edge and never stores their position', () => {
    const tile = newTile('Live', source('live&live=1&duration=200'));
    const health: PlayerHealth[] = [];
    const onPlaybackProgress = vi.fn();
    const view = render(
      <PlayerTile
        tile={tile}
        onHealth={(value) => health.push(value)}
        onPlaybackProgress={onPlaybackProgress}
      />,
    );
    view.rerender(
      <PlayerTile
        tile={tile}
        onHealth={(value) => health.push(value)}
        onPlaybackProgress={onPlaybackProgress}
        command={{ id: 'live', tileId: tile.id, command: 'go-live', sentAt: 1 }}
      />,
    );
    expect(health.some((item) => item.isLive && item.atLiveEdge && item.message === 'LIVE')).toBe(
      true,
    );
    expect(onPlaybackProgress).not.toHaveBeenCalled();
  });

  it('uses the YouTube adapter to return live video to its current edge', async () => {
    const seekTo = vi.fn();
    const playVideo = vi.fn();
    window.YT = {
      Player: class {
        constructor(_node: HTMLElement, options: { events: { onReady: () => void } }) {
          queueMicrotask(() => options.events.onReady());
        }
        playVideo = playVideo;
        pauseVideo = vi.fn();
        seekTo = seekTo;
        mute = vi.fn();
        unMute = vi.fn();
        setVolume = vi.fn();
        getCurrentTime = () => 30;
        getDuration = () => 120;
        getVideoData = () => ({ isLive: true, title: 'Mock live' });
        getPlaylistIndex = () => 0;
        destroy = vi.fn();
      },
    };
    const tile = {
      ...newTile('YouTube Live', {
        type: 'youtube' as const,
        url: 'https://www.youtube.com/watch?v=abcdefghijk',
        youtubeId: 'abcdefghijk',
      }),
      playback: { behavior: 'live' as const },
    };
    render(<PlayerTile tile={tile} />);
    await waitFor(() => expect(seekTo).toHaveBeenCalledWith(118, true));
    expect(playVideo).toHaveBeenCalled();
  });

  it('mounts a playlist without videoId and explicitly loads its canonical playlist', async () => {
    const loadPlaylist = vi.fn();
    let options: any;
    window.YT = {
      Player: class {
        constructor(_node: HTMLElement, nextOptions: any) {
          options = nextOptions;
          queueMicrotask(() => nextOptions.events.onReady());
        }
        loadPlaylist = loadPlaylist;
        playVideo = vi.fn();
        pauseVideo = vi.fn();
        seekTo = vi.fn();
        mute = vi.fn();
        unMute = vi.fn();
        isMuted = () => true;
        setVolume = vi.fn();
        getCurrentTime = () => 0;
        getDuration = () => 120;
        getVideoData = () => ({});
        getPlaylist = () => ['one', 'two'];
        getPlaylistIndex = () => 0;
        previousVideo = vi.fn();
        nextVideo = vi.fn();
        stopVideo = vi.fn();
        destroy = vi.fn();
      },
    };
    const tile = newTile('Playlist', {
      type: 'youtube-playlist',
      url: 'https://www.youtube.com/playlist?list=PL1234567890abcdef',
      playlistId: 'PL1234567890abcdef',
      playlistStartIndex: 2,
    });
    render(<PlayerTile tile={tile} />);
    await waitFor(() => expect(loadPlaylist).toHaveBeenCalledOnce());
    expect(options).not.toHaveProperty('videoId');
    expect(options.playerVars).not.toHaveProperty('list');
    expect(loadPlaylist).toHaveBeenCalledWith(
      expect.objectContaining({
        listType: 'playlist',
        list: 'PL1234567890abcdef',
        index: 2,
      }),
    );
  });

  it('retains pre-ready playlist commands and applies them in order', async () => {
    const calls: string[] = [];
    let onReady: (() => void) | undefined;
    window.YT = {
      Player: class {
        constructor(_node: HTMLElement, options: any) {
          onReady = options.events.onReady;
        }
        loadPlaylist = () => calls.push('loadPlaylist');
        playVideo = () => calls.push('play');
        pauseVideo = () => calls.push('pause');
        seekTo = () => calls.push('seek');
        mute = () => calls.push('mute');
        unMute = () => calls.push('unmute');
        isMuted = () => false;
        setVolume = () => calls.push('volume');
        getCurrentTime = () => 0;
        getDuration = () => 120;
        getVideoData = () => ({});
        getPlaylist = () => ['one', 'two'];
        getPlaylistIndex = () => 0;
        previousVideo = () => calls.push('previous');
        nextVideo = () => calls.push('next');
        stopVideo = vi.fn();
        destroy = vi.fn();
      },
    };
    const tile = newTile('Playlist', {
      type: 'youtube-playlist',
      url: 'https://www.youtube.com/playlist?list=PL1234567890abcdef',
      playlistId: 'PL1234567890abcdef',
    });
    const view = render(<PlayerTile tile={tile} />);
    await waitFor(() => expect(onReady).not.toBe(undefined));
    for (const [id, command, value] of [
      ['play', 'play'],
      ['pause', 'pause'],
      ['unmute', 'unmute'],
      ['volume', 'volume', 42],
      ['next', 'next'],
    ] as const) {
      view.rerender(
        <PlayerTile
          tile={tile}
          command={{ id, tileId: tile.id, command, value, sentAt: calls.length }}
        />,
      );
    }
    act(() => onReady?.());
    await waitFor(() => expect(calls).toContain('next'));
    expect(calls.indexOf('loadPlaylist')).toBeLessThan(calls.indexOf('play'));
    expect(
      calls.filter((call) => ['play', 'pause', 'unmute', 'volume', 'next'].includes(call)),
    ).toEqual(['volume', 'unmute', 'play', 'pause', 'unmute', 'volume', 'next']);
  });

  it('fails playlist readiness after a bounded timeout and can retry', async () => {
    vi.useFakeTimers();
    let mounts = 0;
    window.YT = {
      Player: class {
        constructor() {
          mounts += 1;
        }
        destroy = vi.fn();
      },
    };
    const tile = newTile('Playlist', {
      type: 'youtube-playlist',
      url: 'https://www.youtube.com/playlist?list=PL1234567890abcdef',
      playlistId: 'PL1234567890abcdef',
    });
    const view = render(<PlayerTile tile={tile} />);
    await act(async () => Promise.resolve());
    expect(mounts).toBe(1);
    act(() => vi.advanceTimersByTime(12_000));
    expect(view.container.querySelector('.player-tile')).toHaveAttribute('data-health', 'failed');
    expect(view.container).toHaveTextContent('Select Retry now');
    view.rerender(
      <PlayerTile
        tile={tile}
        command={{ id: 'retry', tileId: tile.id, command: 'retry', sentAt: 1 }}
      />,
    );
    await act(async () => Promise.resolve());
    expect(mounts).toBe(2);
    vi.useRealTimers();
  });

  it('uses the safe end of the mocked HLS seekable range as live edge', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'seekable', 'get').mockReturnValue({
      length: 1,
      start: () => 0,
      end: () => 100,
    });
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockReturnValue(Infinity);
    const tile = {
      ...newTile('HLS Live', {
        type: 'hls' as const,
        url: 'https://example.com/live/channel.m3u8',
      }),
      playback: { behavior: 'live' as const },
    };
    const view = render(<PlayerTile tile={tile} />);
    expect((view.container.querySelector('video') as HTMLVideoElement).currentTime).toBe(98);
  });

  it('reports rejected unmuted play and clears the lock after Wall activation retries it', async () => {
    const tile = {
      ...newTile('Audio', source('audio&rejectPlay=1')),
      muted: false,
    };
    const health: PlayerHealth[] = [];
    const onHealth = (item: PlayerHealth) => health.push(item);
    const view = render(<PlayerTile tile={tile} onHealth={onHealth} />);
    view.rerender(
      <PlayerTile
        tile={tile}
        onHealth={onHealth}
        command={{ id: 'play', tileId: tile.id, command: 'play', sentAt: 1 }}
      />,
    );
    await waitFor(() =>
      expect(health.some((item) => item.audioActivationRequired === true)).toBe(true),
    );
    act(() => window.dispatchEvent(new Event('livewall-enable-audio')));
    await waitFor(() => expect(health.at(-1)?.audioActivationRequired).toBe(false), {
      timeout: 1_500,
    });
    expect(view.container.querySelector('.mock-player')).toHaveAttribute('data-playing', 'true');
  });

  it('restores a playlist index, advances sequentially, and stops at the final item', () => {
    const tile = newTile('Playlist', source('playlist&playlist=First,Second,Third'));
    const health: PlayerHealth[] = [];
    const onHealth = (item: PlayerHealth) => health.push(item);
    const progress = { key: tile.source.url, position: 12, playlistIndex: 1, updatedAt: 1 };
    const view = render(<PlayerTile tile={tile} progress={progress} onHealth={onHealth} />);
    for (const id of ['next-1', 'next-2']) {
      view.rerender(
        <PlayerTile
          tile={tile}
          progress={progress}
          onHealth={onHealth}
          command={{ id, tileId: tile.id, command: 'next', sentAt: 2 }}
        />,
      );
    }
    expect(health.some((item) => item.playlistIndex === 2 && item.currentTitle === 'Third')).toBe(
      true,
    );
    expect(health.at(-1)?.message).toBe('Playlist complete');
    expect(health.at(-1)?.status).toBe('paused');
  });

  it('renders no overlay in Off mode', () => {
    const tile = newTile('Off', source('off'));
    const view = render(<PlayerTile tile={tile} overlayMode="off" />);
    expect(view.container.querySelector('.tile-label')).toBeNull();
    expect(view.container.querySelector('.player-tile')).not.toHaveAttribute('tabindex');
  });

  it('renders a keyboard-focusable delayed overlay in On hover mode', () => {
    const tile = newTile('Hover', source('hover'));
    const view = render(<PlayerTile tile={tile} overlayMode="hover" />);
    expect(view.container.querySelector('.tile-label')).toBeInTheDocument();
    expect(view.container.querySelector('.player-tile')).toHaveClass('overlay-hover');
    expect(view.container.querySelector('.player-tile')).toHaveAttribute('tabindex', '0');
  });

  it('renders the persistent overlay in Always visible mode', () => {
    const tile = newTile('Always', source('always'));
    const view = render(<PlayerTile tile={tile} overlayMode="always" />);
    expect(view.container.querySelector('.tile-label')).toBeInTheDocument();
    expect(view.container.querySelector('.player-tile')).toHaveClass('overlay-always');
    expect(view.container.querySelector('.player-tile')).toHaveAttribute('tabindex', '0');
  });

  it('retries a recoverable adapter failure without affecting another player', () => {
    vi.useFakeTimers();
    const failing = newTile('Failing', source('failing&health=recoverable'));
    const healthy = newTile('Healthy', source('healthy'));
    const view = render(
      <>
        <PlayerTile tile={failing} />
        <PlayerTile tile={healthy} />
      </>,
    );
    const healthyBefore = view.container.querySelectorAll('.mock-player')[1];
    expect(view.container.querySelector(`[data-tile-id="${failing.id}"]`)).toHaveAttribute(
      'data-health',
      'retrying',
    );
    act(() => vi.advanceTimersByTime(1_500));
    expect(view.container.querySelector(`[data-tile-id="${failing.id}"]`)).toHaveAttribute(
      'data-health',
      'playing',
    );
    expect(view.container.querySelector(`[data-tile-id="${healthy.id}"] .mock-player`)).toBe(
      healthyBefore,
    );
    vi.useRealTimers();
  });
});
