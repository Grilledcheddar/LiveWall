import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import legacyState from '../test/fixtures/legacy-pre-p1.json';
import type { WallState } from '../lib/types';

const wallMock = vi.hoisted(() => ({
  state: undefined as unknown as WallState,
  save: vi.fn(),
  command: vi.fn(),
  reportHealth: vi.fn(),
  reportResumePosition: vi.fn(),
}));

vi.mock('../hooks/useWall', () => ({
  useWall: () => ({ ...wallMock, connected: true, healthByTile: {} }),
}));
vi.mock('../components/PlayerTile', () => ({
  PlayerTile: ({ tile }: { tile: { name: string } }) => <div>{tile.name}</div>,
}));

import { AdminPage } from './AdminPage';
import { WallPage } from './WallPage';

describe('legacy route startup', () => {
  beforeEach(() => {
    wallMock.state = structuredClone(legacyState) as unknown as WallState;
  });
  afterEach(cleanup);

  it('renders Admin with the actual pre-P1 state', () => {
    render(<AdminPage />);
    expect(screen.getByRole('heading', { name: 'Video sources' })).toBeVisible();
  });

  it('renders Wall with the actual pre-P1 state', () => {
    const view = render(<WallPage />);
    expect(
      within(view.container).getByText('LIVE Brooks Falls - Katmai National Park, Alaska'),
    ).toBeVisible();
  });
});
