import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tile } from '../lib/types';
import { SourceDialog } from './AdminPage';

const tile: Tile = {
  id: 'tile-1',
  name: 'Library Camera',
  titleMode: 'manual',
  source: { type: 'mock', url: 'https://mock.livewall.local/?label=camera' },
  x: 0,
  y: 0,
  w: 1,
  h: 1,
  muted: true,
  volume: 40,
  displayOrder: 0,
};

function Harness() {
  const [open, setOpen] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        onClick={(event) => {
          setReturnFocus(event.currentTarget);
          setOpen(true);
        }}
      >
        Open Save Source
      </button>
      {open && (
        <SourceDialog
          kind="save"
          tile={tile}
          returnFocus={returnFocus}
          onClose={() => setOpen(false)}
          onSubmit={vi.fn().mockResolvedValue(undefined)}
        />
      )}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.style.overflow = '';
});

describe('Save Source dialog dismissal', () => {
  it.each([
    [
      'top-right X',
      () => fireEvent.click(screen.getByRole('button', { name: /close save source dialog/i })),
    ],
    ['Cancel', () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['backdrop', () => fireEvent.mouseDown(screen.getByTestId('source-dialog-backdrop'))],
  ])('closes with %s and restores focus', async (_method, close) => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open Save Source' });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Save Source' })).toBeInTheDocument();
    expect(document.body.style.overflow).toBe('hidden');

    close();

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(document.body.style.overflow).toBe('');
  });

  it('warns only when edited values would be discarded', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Open Save Source' }));

    screen.getByLabelText('Tile title').focus();
    fireEvent.change(screen.getByLabelText('Tile title'), { target: { value: 'Edited camera' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirm).toHaveBeenCalledWith('Discard your unsaved changes?');
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
