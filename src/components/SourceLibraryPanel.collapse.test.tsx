import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../lib/state';
import { SourceLibraryPanel } from './SourceLibraryPanel';

const folder = { id: 'news', name: 'News', displayOrder: 0, createdAt: 1, updatedAt: 1 };
const entry = {
  id: 'source-1',
  originalUrl: 'https://example.com/live.m3u8',
  canonicalUrl: 'https://example.com/live.m3u8',
  source: { type: 'hls' as const, url: 'https://example.com/live.m3u8' },
  title: 'News stream',
  titleMode: 'manual' as const,
  saved: true,
  favorite: false,
  recent: false,
  folderId: folder.id,
  createdAt: 1,
  updatedAt: 1,
  lastUsedAt: 1,
  useCount: 1,
};

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('Source Library collapsing', () => {
  it('persists folder collapse locally without altering library data', () => {
    const state = {
      ...emptyState(),
      library: { version: 1 as const, folders: [folder], entries: [entry] },
    };
    const saveLibrary = vi.fn().mockResolvedValue(undefined);
    const props = {
      state,
      saveState: vi.fn().mockResolvedValue(undefined),
      saveLibrary,
      importLibrary: vi.fn(),
      onFeedback: vi.fn(),
    };
    const view = render(<SourceLibraryPanel {...props} />);
    expect(screen.getByText('News stream')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /News 1/ }));
    expect(screen.queryByText('News stream')).not.toBeInTheDocument();
    expect(saveLibrary).not.toHaveBeenCalled();
    view.unmount();
    render(<SourceLibraryPanel {...props} />);
    expect(screen.getByRole('button', { name: /News 1/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('News stream')).not.toBeInTheDocument();
  });
});
