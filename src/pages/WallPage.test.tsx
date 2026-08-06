import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../lib/state';
import { WallPage } from './WallPage';

vi.mock('../hooks/useWall', () => ({
  useWall: () => ({ state: emptyState(), connected: true }),
}));

describe('Wall fullscreen control', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/wall');
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
  });
  afterEach(() => cleanup());

  it('calls the Fullscreen API and changes to Exit Fullscreen', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    render(<WallPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter Fullscreen' }));
    expect(requestFullscreen).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    });
    fireEvent(document, new Event('fullscreenchange'));
    expect(await screen.findByRole('button', { name: 'Exit Fullscreen' })).toBeVisible();
  });

  it('shows a useful message when fullscreen is rejected', async () => {
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error('denied')),
    });
    render(<WallPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Enter Fullscreen' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Fullscreen was blocked');
  });

  it('does not render an invisible or interactive fullscreen control for kiosk launches', () => {
    window.history.replaceState({}, '', '/wall?launchMode=kiosk');
    render(<WallPage />);
    expect(screen.queryByRole('button', { name: /Fullscreen/ })).not.toBeInTheDocument();
  });

  it('retains the fullscreen control for a normal Wall launch', () => {
    render(<WallPage />);
    expect(screen.getByRole('button', { name: 'Enter Fullscreen' })).toBeVisible();
  });
});
