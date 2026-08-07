import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState, newTile } from '../lib/state';
import { normalizeLayoutTemplates } from '../lib/layouts';
import { createWallPreset, normalizeWallPresets } from '../lib/walls';
import type { WallState } from '../lib/types';
import { P3WorkspacePanel } from './P3WorkspacePanel';

const source = (label: string) => ({
  type: 'mock' as const,
  url: `https://mock.livewall.local/?label=${label}`,
});

function renderPanel(overrides?: Partial<React.ComponentProps<typeof P3WorkspacePanel>>) {
  const state: WallState = {
    ...emptyState(),
    tiles: [
      { ...newTile('One', source('one')), id: 'one', displayOrder: 0 },
      { ...newTile('Two', source('two')), id: 'two', displayOrder: 1 },
    ],
  };
  const props = {
    state,
    templates: normalizeLayoutTemplates(undefined),
    presets: normalizeWallPresets(undefined),
    saveState: vi.fn(async (change: (value: WallState) => WallState) => change(state)),
    saveTemplates: vi.fn().mockResolvedValue(undefined),
    savePresets: vi.fn().mockResolvedValue(undefined),
    onFeedback: vi.fn(),
    ...overrides,
  };
  render(<P3WorkspacePanel {...props} />);
  return { state, props };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

describe('P3 workspace', () => {
  it('requires a layout preview and blocks layouts with too few slots', () => {
    const { props } = renderPanel();
    const card = screen.getByText('Single tile').closest('article')!;
    fireEvent.click(card.querySelector('button')!);
    expect(screen.getByRole('dialog', { name: /Preview: Single tile/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Layout' })).toBeDisabled();
    expect(props.saveState).not.toHaveBeenCalled();
  });

  it('applies layout using stable tile IDs and restores focus after Escape', async () => {
    const { props } = renderPanel();
    const card = screen.getByText('Two side-by-side').closest('article')!;
    const trigger = card.querySelector('button')!;
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Apply Layout' }));
    const change = vi.mocked(props.saveState).mock.calls[0][0];
    const next = change(props.state);
    expect(next.tiles.map((tile) => tile.id)).toEqual(['one', 'two']);
    expect(next.tiles.map((tile) => tile.source.url)).toEqual(
      props.state.tiles.map((tile) => tile.source.url),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('provides custom builder Cancel, Escape, dirty warning, Undo, Reset, Preview, and Save', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'New Custom Layout' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Unique template name'), {
      target: { value: 'News desk' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add slot' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('previews a named wall without changing it and offers full or layout-only application', () => {
    const state = {
      ...emptyState(),
      tiles: [{ ...newTile('Saved', source('saved')), id: 'saved' }],
    };
    const presets = createWallPreset(normalizeWallPresets(undefined), 'Morning wall', state, 10);
    const { props } = renderPanel({ presets });
    const namedWalls = document.querySelector('.named-walls-section')!;
    fireEvent.click(within(namedWalls as HTMLElement).getByRole('button', { name: 'Preview' }));
    expect(props.saveState).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Apply Layout Only' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Replace Current Wall' })).toBeEnabled();
  });
});
