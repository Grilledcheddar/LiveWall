import { describe, expect, it } from 'vitest';
import legacyState from '../test/fixtures/legacy-pre-p1.json';
import {
  automaticGrid,
  advanceQueueOnCompletion,
  addSourceAsTile,
  clearRemainingQueue,
  insertQueueSource,
  emptyState,
  migrateState,
  moveQueueEntry,
  moveTile,
  newTile,
  normalizeAppearance,
  normalizeWallState,
  orderedTiles,
  reorderTile,
  reconcileTimers,
  replaceTileSource,
  playNextSource,
  playNowQueueSource,
  queueSourceForTile,
  recordSourceInState,
  removeQueueEntry,
  selectActiveAudio,
} from './state';
import type { VideoSource } from './types';

const source = (label: string): VideoSource => ({
  type: 'mock',
  url: `https://mock.livewall.local/?label=${label}`,
});

describe('automatic layouts', () => {
  it.each([
    [1, 1, 1],
    [2, 2, 1],
    [3, 2, 2],
    [4, 2, 2],
    [5, 3, 2],
    [6, 3, 2],
    [7, 3, 3],
    [8, 3, 3],
    [9, 3, 3],
  ])('lays out %i tiles', (count, columns, rows) =>
    expect(automaticGrid(count)).toEqual({ columns, rows }),
  );
});

describe('state rules', () => {
  it('migrates website embed profiles safely without changing tile identity', () => {
    const existing = newTile('Website', { type: 'website', url: 'https://example.com' });
    const safe = normalizeWallState({ ...emptyState(), tiles: [existing] });
    expect(safe.tiles[0].id).toBe(existing.id);
    expect(safe.tiles[0].source).toMatchObject({
      embedProfile: 'safe',
      embedReferrerPolicy: 'no-referrer',
    });
    const compatibility = normalizeWallState({
      ...safe,
      tiles: [
        {
          ...safe.tiles[0],
          source: {
            ...safe.tiles[0].source,
            embedProfile: 'compatibility',
            compatibilityConfirmed: true,
          },
        },
      ],
    });
    expect(compatibility.tiles[0].source.embedProfile).toBe('compatibility');
  });

  it('normalizes Weatherwise as External Only while preserving its URL fragment', () => {
    const weatherwise = newTile('Weatherwise', {
      type: 'website',
      url: 'https://web.weatherwise.app/#map=8.03/35.519/-97.062&rt=KTLX&rp=REF0',
    });
    const state = normalizeWallState({
      ...emptyState(),
      tiles: [
        {
          ...weatherwise,
          source: {
            type: 'website',
            url: 'https://web.weatherwise.app/#map=8.03/35.519/-97.062&rt=KTLX&rp=REF0',
            embedProfile: 'compatibility',
            compatibilityConfirmed: true,
          },
        },
      ],
    });
    expect(state.tiles[0].source.embedProfile).toBe('external');
    expect(state.tiles[0].source.url).toContain('#map=8.03/35.519/-97.062&rt=KTLX&rp=REF0');
  });
  it('recovers an expired queued replacement after reload', () => {
    const tile = { ...newTile('A', source('old')), queuedSource: source('new'), scheduledAt: 100 };
    const result = reconcileTimers({ ...emptyState(), tiles: [tile] }, 101);
    expect(result.tiles[0].source.url).toContain('new');
    expect(result.tiles[0].queue?.map((entry) => entry.source.url)).toEqual([
      source('old').url,
      source('new').url,
    ]);
    expect(result.tiles[0].queuePosition).toBe(1);
  });
  it('keeps future timers intact', () => {
    const tile = { ...newTile('A', source('old')), queuedSource: source('new'), scheduledAt: 200 };
    expect(
      reconcileTimers({ ...emptyState(), tiles: [tile] }, 100).tiles[0].queuedSource,
    ).toBeDefined();
  });
  it('mutes every tile except active audio', () => {
    const first = newTile('A', source('a'));
    const second = newTile('B', source('b'));
    const result = selectActiveAudio({ ...emptyState(), tiles: [first, second] }, second.id);
    expect(result.tiles.map((tile) => tile.muted)).toEqual([true, false]);
  });
  it('preserves freeform coordinates when layout mode changes', () => {
    const tile = { ...newTile('A', source('a')), x: 7, y: 3, w: 5, h: 6 };
    const state = { ...emptyState(), layoutMode: 'freeform' as const, tiles: [tile] };
    expect({ ...state, layoutMode: 'automatic' as const }.tiles[0]).toMatchObject({
      x: 7,
      y: 3,
      w: 5,
      h: 6,
    });
  });

  it('migrates existing tiles to manual titles without losing data', () => {
    const legacy = {
      ...newTile('Legacy title', source('legacy')),
      titleMode: undefined,
      volume: 63,
      queuedSource: source('queued'),
      scheduledAt: 999_999,
      x: 7,
      y: 4,
      w: 5,
      h: 6,
    };
    const migrated = migrateState({ ...emptyState(), tiles: [legacy] }).tiles[0];
    expect(migrated).toMatchObject({
      id: legacy.id,
      name: 'Legacy title',
      titleMode: 'manual',
      volume: 63,
      scheduledAt: 999_999,
      x: 7,
      y: 4,
      w: 5,
      h: 6,
    });
    expect(migrated.source).toEqual(legacy.source);
    expect(migrated.queuedSource).toBeUndefined();
    expect(migrated.queue?.map((entry) => entry.source)).toEqual([
      legacy.source,
      legacy.queuedSource,
    ]);
  });

  it('Replace Now changes only the chosen tile and preserves its queue', () => {
    const first = { ...newTile('First', source('first')), queuedSource: source('queued') };
    const second = newTile('Second', source('second'));
    const result = replaceTileSource({ ...emptyState(), tiles: [first, second] }, first.id, {
      name: 'Replacement',
      source: source('replacement'),
      titleMode: 'manual',
    });
    expect(result.tiles[0]).toMatchObject({
      id: first.id,
      name: 'Replacement',
      volume: first.volume,
    });
    expect(result.tiles[0].queuedSource).toEqual(first.queuedSource);
    expect(result.tiles[1]).toBe(second);
  });

  it('migrates all P1 defaults without losing legacy tile data', () => {
    const tile = { ...newTile('Legacy', source('legacy')), displayOrder: undefined };
    const legacy = {
      ...emptyState(),
      globallyStopped: undefined,
      overlayMode: undefined,
      appearance: undefined,
      tiles: [tile],
    } as unknown as ReturnType<typeof emptyState>;
    const migrated = migrateState(legacy);
    expect(migrated.globallyStopped).toBe(false);
    expect(migrated.overlayMode).toBe('hover');
    expect(migrated.appearance).toMatchObject({ backgroundColor: '#020305', gap: 4 });
    expect(migrated.tiles[0]).toMatchObject({ id: tile.id, displayOrder: 0 });
  });

  it.each([
    ['missing', undefined],
    ['null', null],
  ])('uses canonical defaults for %s appearance', (_label, appearance) => {
    expect(normalizeAppearance(appearance)).toEqual(emptyState().appearance);
  });

  it('deep-merges a partial appearance object', () => {
    expect(normalizeAppearance({ backgroundColor: '#123456' })).toEqual({
      ...emptyState().appearance,
      backgroundColor: '#123456',
    });
  });

  it('replaces malformed individual appearance values safely', () => {
    expect(
      normalizeAppearance({
        backgroundColor: 'red',
        gap: Number.NaN,
        borderVisible: 'yes',
        borderColor: null,
        borderWidth: Infinity,
        cornerRadius: -20,
      }),
    ).toEqual({ ...emptyState().appearance, cornerRadius: 0 });
  });

  it('normalizes the actual pre-P1 state and preserves every playback field', () => {
    const migrated = normalizeWallState(legacyState);
    expect(migrated).toMatchObject({
      version: legacyState.version,
      updatedAt: legacyState.updatedAt,
      layoutMode: legacyState.layoutMode,
      activeAudioTileId: legacyState.activeAudioTileId,
      globallyStopped: false,
      overlayMode: 'hover',
      appearance: emptyState().appearance,
    });
    expect(migrated.tiles).toHaveLength(legacyState.tiles.length);
    legacyState.tiles.forEach((before, index) => {
      expect(migrated.tiles[index]).toMatchObject(before);
      expect(migrated.tiles[index].displayOrder).toBe(index);
    });
  });

  it('normalizes every missing or malformed P1 field together', () => {
    const tile = newTile('Legacy', source('legacy'));
    const migrated = normalizeWallState({
      ...emptyState(),
      appearance: null,
      overlayMode: 'sometimes',
      globallyStopped: 'false',
      focusedTileId: 'missing',
      tiles: [{ ...tile, displayOrder: 'first', resumePosition: -5 }],
    });
    expect(migrated).toMatchObject({
      appearance: emptyState().appearance,
      overlayMode: 'hover',
      globallyStopped: false,
      focusedTileId: undefined,
    });
    expect(migrated.tiles[0]).toMatchObject({ displayOrder: 0, resumePosition: undefined });
  });

  it('reorders display order while preserving freeform geometry and player identity', () => {
    const first = { ...newTile('First', source('first')), displayOrder: 0, x: 8, y: 5 };
    const second = { ...newTile('Second', source('second')), displayOrder: 1, x: 2, y: 9 };
    const third = { ...newTile('Third', source('third')), displayOrder: 2 };
    const initial = { ...emptyState(), tiles: [first, second, third] };
    const moved = moveTile(initial, second.id, -1);
    expect(orderedTiles(moved.tiles).map((tile) => tile.id)).toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    expect(moved.tiles.find((tile) => tile.id === second.id)).toMatchObject({ x: 2, y: 9 });
    const dragged = reorderTile(moved, third.id, second.id);
    expect(orderedTiles(dragged.tiles).map((tile) => tile.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ]);
    expect(dragged.tiles.find((tile) => tile.id === first.id)?.source).toBe(first.source);
  });

  it('clears stale focus during migration and clamps appearance inputs', () => {
    const migrated = migrateState({
      ...emptyState(),
      focusedTileId: 'deleted',
      appearance: {
        backgroundColor: 'invalid',
        borderColor: '#aabbcc',
        gap: 99,
        borderVisible: true,
        borderWidth: -2,
        cornerRadius: 100,
      },
    });
    expect(migrated.focusedTileId).toBeUndefined();
    expect(migrated.appearance).toEqual({
      backgroundColor: '#020305',
      borderColor: '#aabbcc',
      gap: 32,
      borderVisible: true,
      borderWidth: 0,
      cornerRadius: 32,
    });
  });

  it('adds canonical library defaults to legacy, null, and partial state without changing tiles', () => {
    const tile = newTile('Existing', source('existing'));
    for (const library of [undefined, null, {}, { entries: null }]) {
      const migrated = normalizeWallState({ ...emptyState(), library, tiles: [tile] });
      expect(migrated.library).toEqual(emptyState().library);
      expect(migrated.tiles[0]).toMatchObject(tile);
    }
  });

  it('records queue activation while preserving tile identity and unrelated players', () => {
    const first = { ...newTile('First', source('first')), queuedSource: source('queued') };
    const second = newTile('Second', source('second'));
    const result = playNextSource({ ...emptyState(), tiles: [first, second] }, first.id, 100);
    expect(result.tiles[0]).toMatchObject({ id: first.id, source: source('queued') });
    expect(result.tiles[1]).toBe(second);
    expect(result.library.entries[0]).toMatchObject({ recent: true, useCount: 1 });
  });

  it('records source metadata without mutating active tiles', () => {
    const tile = newTile('Stable', source('stable'));
    const state = { ...emptyState(), tiles: [tile] };
    const result = recordSourceInState(state, source('library'), 'Library source', 'manual', 100);
    expect(result.tiles).toBe(state.tiles);
    expect(result.library.entries[0].title).toBe('Library source');
  });

  it('refuses a tenth tile from the Source Library without recording a false use', () => {
    const tiles = Array.from({ length: 9 }, (_, index) =>
      newTile(`Tile ${index}`, source(String(index))),
    );
    const state = { ...emptyState(), tiles };
    expect(addSourceAsTile(state, source('ten'), 'Ten')).toBe(state);
    expect(state.library.entries).toHaveLength(0);
  });

  it('migrates a legacy single-item queue and appends or replaces upcoming items', () => {
    const tile = {
      ...newTile('Tile', source('current')),
      queuedSource: source('existing'),
      scheduledAt: 500,
    };
    const state = { ...emptyState(), tiles: [tile] };
    const appended = queueSourceForTile(state, tile.id, source('new'), 'New');
    expect(appended.tiles[0].queue?.map((entry) => entry.source.url)).toEqual([
      source('current').url,
      source('existing').url,
      source('new').url,
    ]);
    const replaced = queueSourceForTile(state, tile.id, source('new'), 'New', 'manual', true, 100);
    expect(replaced.tiles[0].queue?.map((entry) => entry.source.url)).toEqual([
      source('current').url,
      source('new').url,
    ]);
    expect(replaced.library.entries[0].title).toBe('New');
  });

  it('orders Play Now, Play Next, and Add to Queue on one target tile only', () => {
    const first = newTile('First', source('first'));
    const second = newTile('Second', source('second'));
    const initial = { ...emptyState(), tiles: [first, second] };
    const appended = insertQueueSource(initial, first.id, source('append'), 'Append', 'append');
    const next = insertQueueSource(appended, first.id, source('next'), 'Next', 'next');
    const played = playNowQueueSource(next, first.id, source('now'), 'Now');
    expect(played.tiles[0].queue?.map((entry) => entry.title)).toEqual(['Now', 'Next', 'Append']);
    expect(played.tiles[0].source).toEqual(source('now'));
    expect(played.tiles[1]).toBe(second);
  });

  it('reorders, removes, clears, and persists remaining queue entries', () => {
    const tile = newTile('Tile', source('current'));
    const initial = insertQueueSource(
      insertQueueSource(
        { ...emptyState(), tiles: [tile] },
        tile.id,
        source('one'),
        'One',
        'append',
      ),
      tile.id,
      source('two'),
      'Two',
      'append',
    );
    const entries = initial.tiles[0].queue!;
    const moved = moveQueueEntry(initial, tile.id, entries[2].id, -1);
    expect(moved.tiles[0].queue?.map((entry) => entry.title)).toEqual(['Tile', 'Two', 'One']);
    const removed = removeQueueEntry(moved, tile.id, entries[1].id);
    expect(removed.tiles[0].queue?.map((entry) => entry.title)).toEqual(['Tile', 'Two']);
    const cleared = clearRemainingQueue(removed, tile.id);
    expect(cleared.tiles[0].queue).toHaveLength(1);
    expect(normalizeWallState(cleared).tiles[0].queue).toHaveLength(1);
  });

  it('advances past unsupported or external-only entries and stops cleanly at queue end', () => {
    const tile = newTile('Tile', source('current'));
    const queued = insertQueueSource(
      insertQueueSource(
        { ...emptyState(), tiles: [tile] },
        tile.id,
        { type: 'website', url: 'https://web.weatherwise.app/#map=1' },
        'Weatherwise',
        'append',
      ),
      tile.id,
      source('valid'),
      'Valid',
      'append',
    );
    const advanced = advanceQueueOnCompletion(queued, tile.id);
    expect(advanced.tiles[0]).toMatchObject({ source: source('valid'), queuePosition: 2 });
    expect(advanceQueueOnCompletion(advanced, tile.id)).toBe(advanced);
  });
});
