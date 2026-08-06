import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { newTile } from '../lib/state';
import type { PlayerCommand } from '../lib/types';
import { PlayerTile } from './PlayerTile';

const source = (label: string) => ({
  type: 'mock' as const,
  url: `https://mock.livewall.local/?label=${label}`,
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
