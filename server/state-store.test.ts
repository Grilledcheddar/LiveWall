// @vitest-environment node
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyState, newTile } from '../src/lib/state';
import { recordLibraryUse } from '../src/lib/library';
import { StateStore } from './state-store';
import legacyState from '../src/test/fixtures/legacy-pre-p1.json';

describe('StateStore', () => {
  it('persists and restores authoritative state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-'));
    const store = new StateStore(directory);
    await store.load();
    const tile = newTile('Saved', {
      type: 'mock',
      url: 'https://mock.livewall.local/?label=saved',
    });
    await store.replace({ ...emptyState(), tiles: [tile] });
    const restored = new StateStore(directory);
    await restored.load();
    expect(restored.get().tiles[0].name).toBe('Saved');
    expect(
      JSON.parse(await readFile(path.join(directory, 'wall-state.json'), 'utf8')).tiles,
    ).toHaveLength(1);
  });

  it('migrates a legacy persisted tile without changing its saved fields', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-legacy-'));
    const tile = newTile('Legacy', {
      type: 'mock',
      url: 'https://mock.livewall.local/?label=legacy',
    });
    const legacyTile = { ...tile, titleMode: undefined };
    await writeFile(
      path.join(directory, 'wall-state.json'),
      JSON.stringify({ ...emptyState(), tiles: [{ ...legacyTile, volume: 37 }] }),
      'utf8',
    );
    const store = new StateStore(directory);
    await store.load();
    expect(store.get().tiles[0]).toMatchObject({
      id: tile.id,
      name: 'Legacy',
      titleMode: 'manual',
      volume: 37,
      source: tile.source,
    });
  });

  it('does not overwrite a corrupt saved state when migration fails', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-corrupt-'));
    const file = path.join(directory, 'wall-state.json');
    await writeFile(file, '{"tiles":"not-an-array"}', 'utf8');
    const store = new StateStore(directory);
    await expect(store.load()).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe('{"tiles":"not-an-array"}');
  });

  it('persists a resume position only for the current source', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-position-'));
    const store = new StateStore(directory);
    await store.load();
    const tile = newTile('Saved', {
      type: 'mock',
      url: 'https://mock.livewall.local/?label=position',
    });
    await store.replace({ ...emptyState(), tiles: [tile] });
    await store.saveResumePosition(tile.id, 'https://stale.example/source', 55);
    expect(store.get().tiles[0].resumePosition).toBeUndefined();
    await store.saveResumePosition(tile.id, tile.source.url, 42);
    expect(store.get().tiles[0].resumePosition).toBe(42);
  });

  it('serializes concurrent atomic position writes', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-concurrent-position-'));
    const store = new StateStore(directory);
    await store.load();
    const first = newTile('First', {
      type: 'mock',
      url: 'https://mock.livewall.local/?label=first',
    });
    const second = newTile('Second', {
      type: 'mock',
      url: 'https://mock.livewall.local/?label=second',
    });
    await store.replace({ ...emptyState(), tiles: [first, second] });
    await Promise.all([
      store.saveResumePosition(first.id, first.source.url, 12),
      store.saveResumePosition(second.id, second.source.url, 34),
    ]);
    const reopened = new StateStore(directory);
    await reopened.load();
    expect(reopened.get().tiles.map((tile) => tile.resumePosition)).toEqual([12, 34]);
  });

  it('atomically migrates the actual pre-P1 fixture and reopens it successfully', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-reopen-'));
    const file = path.join(directory, 'wall-state.json');
    await writeFile(file, JSON.stringify(legacyState), 'utf8');
    const firstOpen = new StateStore(directory);
    await firstOpen.load();
    expect(firstOpen.get().appearance).toEqual(emptyState().appearance);
    expect(firstOpen.get().tiles.map((tile) => tile.id)).toEqual(
      legacyState.tiles.map((tile) => tile.id),
    );
    const secondOpen = new StateStore(directory);
    await secondOpen.load();
    expect(secondOpen.get()).toEqual(firstOpen.get());
    expect((await readFile(file, 'utf8')).includes('"appearance"')).toBe(true);
  });

  it('serializes concurrent library writes and rejects a stale writer without losing the winner', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-concurrent-library-'));
    const store = new StateStore(directory);
    await store.load();
    const version = store.get().version;
    const first = recordLibraryUse(
      store.get().library,
      { type: 'mock', url: 'https://mock.livewall.local/?label=first' },
      'First',
    );
    const second = recordLibraryUse(
      store.get().library,
      { type: 'mock', url: 'https://mock.livewall.local/?label=second' },
      'Second',
    );
    const results = await Promise.allSettled([
      store.replaceLibrary(first, version),
      store.replaceLibrary(second, version),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const reopened = new StateStore(directory);
    await reopened.load();
    expect(reopened.get().library.entries).toHaveLength(1);
    expect(['First', 'Second']).toContain(reopened.get().library.entries[0].title);
  });

  it('backs up state before a validated library import and never changes active tiles', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'livewall-library-import-'));
    const store = new StateStore(directory);
    await store.load();
    const tile = newTile('Existing', {
      type: 'mock',
      url: 'https://mock.livewall.local/?label=existing',
    });
    await store.replace({ ...emptyState(), tiles: [tile] });
    const incoming = recordLibraryUse(
      emptyState().library,
      { type: 'mock', url: 'https://mock.livewall.local/?label=imported' },
      'Imported',
    );
    const result = await store.importLibrary({
      format: 'livewall-source-library',
      version: 1,
      exportedAt: 1,
      library: incoming,
    });
    expect(result.state.tiles).toEqual([tile]);
    expect(result.state.library.entries[0].title).toBe('Imported');
    expect(await readFile(result.backupPath, 'utf8')).toContain('Existing');
  });
});
