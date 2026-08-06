import { describe, expect, it } from 'vitest';
import {
  clearLibraryRecents,
  createLibraryFolder,
  deleteLibraryFolder,
  emptyLibrary,
  exportLibrary,
  MAX_RECENT_SOURCES,
  mergeLibraryImport,
  moveLibraryFolder,
  normalizeSourceLibrary,
  previewLibraryImport,
  recordLibraryUse,
  renameLibraryFolder,
  selectLibraryEntries,
  setLibraryFavorite,
  updateLibraryEntry,
} from './library';
import { detectSource } from './sources';

const mock = (label: string) => detectSource(`https://mock.livewall.local/?label=${label}`);

describe('Source Library', () => {
  it('records and reuses recent sources for Add, Replace, Queue, and library actions', () => {
    let library = emptyLibrary();
    for (const [index, action] of ['Add', 'Replace', 'Queue', 'Library'].entries())
      library = recordLibraryUse(library, mock('same'), `${action} source`, 'manual', 100 + index);
    expect(library.entries).toHaveLength(1);
    expect(library.entries[0]).toMatchObject({
      title: 'Library source',
      recent: true,
      useCount: 4,
      lastUsedAt: 103,
    });
  });

  it('deduplicates common YouTube URL forms by video identity', () => {
    const urls = [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&utm_source=test',
      'https://youtube.com/embed/dQw4w9WgXcQ',
      'https://m.youtube.com/shorts/dQw4w9WgXcQ',
    ];
    const library = urls.reduce(
      (current, url, index) =>
        recordLibraryUse(current, detectSource(url), 'Same video', 'auto', index + 1),
      emptyLibrary(),
    );
    expect(library.entries).toHaveLength(1);
    expect(library.entries[0].canonicalUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(library.entries[0].useCount).toBe(4);
  });

  it('bounds recents without removing favorites', () => {
    let library = emptyLibrary();
    library = recordLibraryUse(library, mock('favorite'), 'Favorite', 'manual', 1);
    library = setLibraryFavorite(library, library.entries[0].id, true, 2);
    for (let index = 0; index < MAX_RECENT_SOURCES + 5; index++)
      library = recordLibraryUse(
        library,
        mock(`recent-${index}`),
        `Recent ${index}`,
        'manual',
        10 + index,
      );
    expect(library.entries.filter((entry) => entry.recent)).toHaveLength(MAX_RECENT_SOURCES);
    expect(library.entries.find((entry) => entry.title === 'Favorite')).toMatchObject({
      favorite: true,
      recent: false,
    });
  });

  it('clears Recents while preserving favorites', () => {
    let library = recordLibraryUse(emptyLibrary(), mock('keep'), 'Keep', 'manual', 1);
    library = setLibraryFavorite(library, library.entries[0].id, true, 2);
    library = recordLibraryUse(library, mock('remove'), 'Remove', 'manual', 3);
    const cleared = clearLibraryRecents(library);
    expect(cleared.entries).toHaveLength(1);
    expect(cleared.entries[0]).toMatchObject({ title: 'Keep', favorite: true, recent: false });
  });

  it('favorites, renames, files, and unfavorites without changing source identity', () => {
    let library = recordLibraryUse(emptyLibrary(), mock('item'), 'Item', 'manual', 1);
    const sourceId = library.entries[0].id;
    library = setLibraryFavorite(library, sourceId, true, 2);
    library = createLibraryFolder(library, 'News', 3);
    library = updateLibraryEntry(
      library,
      sourceId,
      { title: 'Daily News', folderId: library.folders[0].id },
      4,
    );
    expect(library.entries[0]).toMatchObject({
      id: sourceId,
      favorite: true,
      title: 'Daily News',
      folderId: library.folders[0].id,
    });
    library = setLibraryFavorite(library, sourceId, false, 5);
    expect(library.entries[0]).toMatchObject({
      favorite: false,
      recent: true,
      folderId: undefined,
    });
  });

  it('creates, renames, reorders, and deletes folders to Unfiled', () => {
    let library = createLibraryFolder(emptyLibrary(), 'News', 1);
    library = createLibraryFolder(library, 'Sports', 2);
    library = renameLibraryFolder(library, library.folders[1].id, 'Cameras', 3);
    library = moveLibraryFolder(library, library.folders[1].id, -1);
    expect(library.folders.map((folder) => folder.name)).toEqual(['Cameras', 'News']);
    library = recordLibraryUse(library, mock('camera'), 'Camera', 'manual', 4);
    library = setLibraryFavorite(library, library.entries[0].id, true, 5);
    library = updateLibraryEntry(
      library,
      library.entries[0].id,
      { folderId: library.folders[0].id },
      6,
    );
    library = deleteLibraryFolder(library, library.folders[0].id);
    expect(library.entries[0].folderId).toBeUndefined();
  });

  it('enforces case-insensitive folder uniqueness', () => {
    const library = createLibraryFolder(emptyLibrary(), 'News');
    expect(() => createLibraryFolder(library, ' news ')).toThrow(/unique/i);
  });

  it('searches title, URL, hostname, and folder and supports filters and sorting', () => {
    let library = createLibraryFolder(emptyLibrary(), 'Cameras');
    library = recordLibraryUse(library, mock('alpha'), 'Alpha Cam', 'manual', 10);
    library = recordLibraryUse(
      library,
      detectSource('https://example.com/live'),
      'Beta Site',
      'manual',
      20,
    );
    library = setLibraryFavorite(
      library,
      library.entries.find((entry) => entry.title === 'Alpha Cam')!.id,
      true,
      21,
    );
    library = updateLibraryEntry(
      library,
      library.entries.find((entry) => entry.title === 'Alpha Cam')!.id,
      { folderId: library.folders[0].id },
    );
    expect(
      selectLibraryEntries(library, { search: 'cameras' }).map((entry) => entry.title),
    ).toEqual(['Alpha Cam']);
    expect(
      selectLibraryEntries(library, { search: 'example.com' }).map((entry) => entry.title),
    ).toEqual(['Beta Site']);
    expect(selectLibraryEntries(library, { filter: 'favorites' })).toHaveLength(1);
    expect(selectLibraryEntries(library, { type: 'website' })).toHaveLength(1);
    expect(selectLibraryEntries(library, { sort: 'name' }).map((entry) => entry.title)).toEqual([
      'Alpha Cam',
      'Beta Site',
    ]);
  });

  it('previews, merges, and round-trips versioned exports', () => {
    const current = recordLibraryUse(emptyLibrary(), mock('same'), 'Old', 'manual', 1);
    let incoming = recordLibraryUse(emptyLibrary(), mock('same'), 'Updated', 'manual', 5);
    incoming = recordLibraryUse(incoming, mock('new'), 'New', 'manual', 6);
    incoming = createLibraryFolder(incoming, 'News', 7);
    const exported = exportLibrary(incoming, 8);
    const preview = previewLibraryImport(current, JSON.parse(JSON.stringify(exported)));
    expect(preview).toMatchObject({
      newSources: 1,
      duplicates: 1,
      updatedMetadata: 1,
      newFolders: 1,
    });
    const merged = mergeLibraryImport(current, preview);
    expect(merged.entries.map((entry) => entry.title).sort()).toEqual(['New', 'Updated']);
    expect(normalizeSourceLibrary(exportLibrary(merged).library)).toEqual(merged);
  });

  it('rejects malformed exports and unsafe URLs', () => {
    expect(() => previewLibraryImport(emptyLibrary(), {})).toThrow(/valid/i);
    expect(() =>
      previewLibraryImport(emptyLibrary(), {
        format: 'livewall-source-library',
        version: 1,
        library: { folders: [], entries: [{ originalUrl: 'javascript:alert(1)' }] },
      }),
    ).toThrow(/unsafe/i);
  });

  it.each([undefined, null, {}, { entries: null, folders: null }])(
    'normalizes missing, null, or partial library data',
    (value) => {
      expect(normalizeSourceLibrary(value)).toEqual(emptyLibrary());
    },
  );
});
