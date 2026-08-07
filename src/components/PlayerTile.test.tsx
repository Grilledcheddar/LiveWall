import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
