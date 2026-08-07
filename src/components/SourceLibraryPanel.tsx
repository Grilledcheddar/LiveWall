import { useEffect, useMemo, useRef, useState } from 'react';
import {
  clearLibraryRecents,
  createLibraryFolder,
  deleteLibraryFolder,
  moveLibraryFolder,
  renameLibraryFolder,
  saveLibrarySource,
  selectLibraryEntries,
  setLibraryFavorite,
  updateLibraryEntry,
  type LibraryFilter,
  type LibraryImportPreview,
  type LibrarySort,
} from '../lib/library';
import {
  addSourceAsTile,
  queueSourceForTile,
  recordSourceInState,
  replaceTileSource,
} from '../lib/state';
import { resolveYouTubeTitle } from '../lib/titles';
import type { LibrarySource, SourceLibrary, WallState } from '../lib/types';

interface Props {
  state: WallState;
  saveState: (change: (state: WallState) => WallState) => Promise<unknown>;
  saveLibrary: (library: SourceLibrary) => Promise<unknown>;
  importLibrary: (payload: unknown) => Promise<{ state: WallState; backupPath: string }>;
  onFeedback: (message: string) => void;
}

export function SourceLibraryPanel({
  state,
  saveState,
  saveLibrary,
  importLibrary,
  onFeedback,
}: Props) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LibraryFilter>('all');
  const [type, setType] = useState('all');
  const [folderId, setFolderId] = useState('all');
  const [sort, setSort] = useState<LibrarySort>('recent');
  const [targetTileId, setTargetTileId] = useState(state.tiles[0]?.id ?? '');
  const [pendingImport, setPendingImport] = useState<{
    payload: unknown;
    preview: LibraryImportPreview;
  }>();
  const importInput = useRef<HTMLInputElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  const entries = useMemo(
    () => selectLibraryEntries(state.library, { search, filter, type, folderId, sort }),
    [filter, folderId, search, sort, state.library, type],
  );
  const resolvedTargetTileId = state.tiles.some((tile) => tile.id === targetTileId)
    ? targetTileId
    : (state.tiles[0]?.id ?? '');

  useEffect(() => {
    if (!pendingImport) return;
    const trigger = importTrigger.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPendingImport(undefined);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => trigger?.focus(), 0);
    };
  }, [pendingImport]);

  async function favorite(entry: LibrarySource) {
    if (!entry.saved) {
      onFeedback('Save this source to the Source Library before adding it to favorites.');
      return;
    }
    const favorite = !entry.favorite;
    await saveLibrary(setLibraryFavorite(state.library, entry.id, favorite));
    onFeedback(
      favorite
        ? `Added ‘${entry.title}’ to favorites.`
        : `Removed ‘${entry.title}’ from favorites.`,
    );
  }

  async function saveSource(entry: LibrarySource) {
    await saveLibrary(
      saveLibrarySource(
        state.library,
        entry.source,
        entry.title,
        entry.titleMode,
        Date.now(),
        entry.playback,
      ),
    );
    onFeedback(`Saved ‘${entry.title}’ to Source Library.`);
  }

  async function addAsTile(entry: LibrarySource) {
    if (state.tiles.length >= 9)
      return onFeedback('The wall already has the maximum of nine tiles.');
    await saveState((current) => {
      const next = addSourceAsTile(current, entry.source, entry.title, entry.titleMode);
      const added = next.tiles[next.tiles.length - 1];
      return {
        ...next,
        tiles: next.tiles.map((tile) =>
          tile.id === added?.id ? { ...tile, playback: entry.playback } : tile,
        ),
      };
    });
    onFeedback(`Added ‘${entry.title}’ as a tile.`);
  }

  async function replaceTile(entry: LibrarySource) {
    const tile = state.tiles.find((candidate) => candidate.id === resolvedTargetTileId);
    if (!tile) return onFeedback('Choose an active tile first.');
    if (
      !confirm(
        `Replace “${tile.name}” (${tile.source.url}) with “${entry.title}” (${entry.originalUrl})?`,
      )
    )
      return;
    await saveState((current) =>
      recordSourceInState(
        replaceTileSource(current, tile.id, {
          name: entry.title,
          source: entry.source,
          titleMode: entry.titleMode,
          playback: entry.playback,
        }),
        entry.source,
        entry.title,
        entry.titleMode,
      ),
    );
    onFeedback(`Replaced ‘${tile.name}’ without changing other players.`);
  }

  async function queueForTile(entry: LibrarySource) {
    const tile = state.tiles.find((candidate) => candidate.id === resolvedTargetTileId);
    if (!tile) return onFeedback('Choose an active tile first.');
    if (
      tile.queuedSource &&
      !confirm(`“${tile.name}” already has ${tile.queuedSource.url} queued. Replace it?`)
    )
      return;
    await saveState((current) =>
      queueSourceForTile(
        current,
        tile.id,
        entry.source,
        entry.title,
        entry.titleMode,
        Boolean(tile.queuedSource),
        Date.now(),
        entry.playback,
      ),
    );
    onFeedback(`Queued ‘${entry.title}’ for ‘${tile.name}’.`);
  }

  async function copyUrl(entry: LibrarySource) {
    await navigator.clipboard.writeText(entry.canonicalUrl);
    onFeedback('Copied the canonical source URL.');
  }

  async function createFolder() {
    const name = prompt('Folder name');
    if (name === null) return;
    try {
      await saveLibrary(createLibraryFolder(state.library, name));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The folder could not be created.');
    }
  }

  async function renameFolder(id: string, currentName: string) {
    const name = prompt('Rename folder', currentName);
    if (name === null) return;
    try {
      await saveLibrary(renameLibraryFolder(state.library, id, name));
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The folder could not be renamed.');
    }
  }

  async function removeFolder(id: string, name: string) {
    const count = state.library.entries.filter((entry) => entry.folderId === id).length;
    if (
      count &&
      !confirm(
        `Move ${count} source${count === 1 ? '' : 's'} from “${name}” to Unfiled and delete the folder?`,
      )
    )
      return;
    if (!count && !confirm(`Delete the empty folder “${name}”?`)) return;
    await saveLibrary(deleteLibraryFolder(state.library, id));
  }

  async function loadImport(file?: File) {
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as unknown;
      const response = await fetch('/api/library/import/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message);
      setPendingImport({ payload, preview: body as LibraryImportPreview });
    } catch (error) {
      alert(error instanceof Error ? error.message : 'The import file is invalid.');
    } finally {
      if (importInput.current) importInput.current.value = '';
    }
  }

  return (
    <section className="source-library" aria-label="Source Library">
      <div className="panel-heading library-heading">
        <div>
          <span className="eyebrow">REUSABLE SOURCES</span>
          <h2>Source Library</h2>
          <p>Save channels, live cameras, HLS feeds, and best-effort websites for reuse.</p>
        </div>
        <div className="library-file-actions">
          <a className="library-action" href="/api/library/export" download>
            Export
          </a>
          <button
            ref={importTrigger}
            className="library-action"
            onClick={() => importInput.current?.click()}
          >
            Import
          </button>
          <input
            ref={importInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => void loadImport(event.target.files?.[0])}
          />
          <button onClick={() => void createFolder()}>New folder</button>
          <button
            disabled={!state.library.entries.some((entry) => entry.recent)}
            title={
              state.library.entries.some((entry) => entry.recent)
                ? 'Remove automatic Recent labels without deleting saved sources.'
                : 'There are no Recent entries to clear.'
            }
            onClick={() => {
              if (
                confirm('Clear recent sources? Saved sources, favorites, and active tiles remain.')
              )
                void saveLibrary(clearLibraryRecents(state.library));
            }}
          >
            Clear Recents
          </button>
        </div>
      </div>

      <div className="folder-manager">
        {state.library.folders.map((folder, index) => (
          <div key={folder.id}>
            <strong>{folder.name}</strong>
            <button
              aria-label={`Move ${folder.name} up`}
              disabled={index === 0}
              onClick={() => void saveLibrary(moveLibraryFolder(state.library, folder.id, -1))}
            >
              ↑
            </button>
            <button
              aria-label={`Move ${folder.name} down`}
              disabled={index === state.library.folders.length - 1}
              onClick={() => void saveLibrary(moveLibraryFolder(state.library, folder.id, 1))}
            >
              ↓
            </button>
            <button onClick={() => void renameFolder(folder.id, folder.name)}>Rename</button>
            <button onClick={() => void removeFolder(folder.id, folder.name)}>Delete</button>
          </div>
        ))}
      </div>

      <div className="library-controls">
        <label>
          Search{' '}
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title, URL, hostname, or folder"
          />
        </label>
        <label>
          Show{' '}
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as LibraryFilter)}
          >
            <option value="all">All</option>
            <option value="saved">Saved</option>
            <option value="favorites">Favorites</option>
            <option value="recents">Recents</option>
          </select>
        </label>
        <label>
          Type{' '}
          <select value={type} onChange={(event) => setType(event.target.value)}>
            <option value="all">All types</option>
            <option value="youtube">YouTube</option>
            <option value="hls">HLS / M3U8</option>
            <option value="website">Website</option>
          </select>
        </label>
        <label>
          Folder{' '}
          <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
            <option value="all">All folders</option>
            <option value="unfiled">Unfiled</option>
            {state.library.folders.map((folder) => (
              <option key={folder.id} value={folder.id}>
                {folder.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort{' '}
          <select value={sort} onChange={(event) => setSort(event.target.value as LibrarySort)}>
            <option value="recent">Recently used</option>
            <option value="name">Name</option>
            <option value="used">Most used</option>
          </select>
        </label>
        <label>
          Target tile{' '}
          <select
            value={resolvedTargetTileId}
            onChange={(event) => setTargetTileId(event.target.value)}
          >
            <option value="">Choose a tile</option>
            {state.tiles.map((tile) => (
              <option key={tile.id} value={tile.id}>
                {tile.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!entries.length ? (
        <div className="library-empty">
          No matching sources. Add or queue a source to create an automatic Recent. Use Save to
          Library to keep it for reuse, then optionally add it to Favorites.
        </div>
      ) : (
        <div className="library-list">
          {entries.map((entry) => {
            const folder = state.library.folders.find((item) => item.id === entry.folderId);
            return (
              <article className="library-source-row" key={entry.id} data-library-id={entry.id}>
                <button
                  className="favorite-star"
                  disabled={!entry.saved}
                  aria-label={
                    entry.favorite
                      ? `Remove ${entry.title} from favorites`
                      : `Add ${entry.title} to favorites`
                  }
                  title={
                    entry.saved
                      ? entry.favorite
                        ? 'Remove from favorites'
                        : 'Add this saved source to favorites'
                      : 'Save to Library before adding this source to favorites.'
                  }
                  onClick={() => void favorite(entry)}
                >
                  {entry.favorite ? '★ Favorited' : '☆ Add to favorites'}
                </button>
                <div className="library-source-copy">
                  <strong>{entry.title}</strong>
                  <span className="library-entry-labels">
                    {entry.source.type === 'website'
                      ? 'WEBSITE · BEST EFFORT'
                      : entry.source.type.toUpperCase()}
                    {entry.recent && <b>Recent</b>}
                    {entry.saved && <b>Saved</b>}
                    {entry.favorite && <b>Favorite</b>}
                  </span>
                  <small>{entry.originalUrl}</small>
                  <small>
                    {folder?.name ?? 'Unfiled'} · Used {entry.useCount} time
                    {entry.useCount === 1 ? '' : 's'} ·{' '}
                    {new Date(entry.lastUsedAt).toLocaleString()}
                  </small>
                </div>
                {entry.saved && (
                  <div className="library-metadata-actions">
                    <button
                      onClick={() => {
                        const title = prompt('Saved source display name', entry.title);
                        if (title !== null)
                          void saveLibrary(updateLibraryEntry(state.library, entry.id, { title }));
                      }}
                    >
                      Edit name
                    </button>
                    {entry.titleMode === 'auto' && entry.source.type === 'youtube' && (
                      <button
                        onClick={async () => {
                          try {
                            const title = await resolveYouTubeTitle(entry.originalUrl);
                            await saveLibrary(
                              updateLibraryEntry(state.library, entry.id, {
                                title,
                                titleMode: 'auto',
                              }),
                            );
                          } catch {
                            alert('The YouTube title is temporarily unavailable.');
                          }
                        }}
                      >
                        Refresh title
                      </button>
                    )}
                    <label>
                      Folder{' '}
                      <select
                        value={entry.folderId ?? ''}
                        onChange={(event) =>
                          void saveLibrary(
                            updateLibraryEntry(state.library, entry.id, {
                              folderId: event.target.value || undefined,
                            }),
                          )
                        }
                      >
                        <option value="">Unfiled</option>
                        {state.library.folders.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div className="library-source-actions">
                  <button
                    disabled={entry.saved}
                    title={
                      entry.saved
                        ? 'This source is already saved for reuse.'
                        : 'Save this Recent as a reusable library source.'
                    }
                    onClick={() => void saveSource(entry)}
                  >
                    {entry.saved ? 'Saved to Library' : 'Save to Library'}
                  </button>
                  <button
                    disabled={state.tiles.length >= 9}
                    title={state.tiles.length >= 9 ? 'The wall is full (9 of 9).' : ''}
                    onClick={() => void addAsTile(entry)}
                  >
                    Add as Tile
                  </button>
                  <button
                    disabled={!state.tiles.length}
                    title={!state.tiles.length ? 'Add an active tile before replacing one.' : ''}
                    onClick={() => void replaceTile(entry)}
                  >
                    Replace Tile
                  </button>
                  <button
                    disabled={!state.tiles.length}
                    title={
                      !state.tiles.length ? 'Add an active tile before queueing a source.' : ''
                    }
                    onClick={() => void queueForTile(entry)}
                  >
                    Queue for Tile
                  </button>
                  <a href={entry.originalUrl} target="_blank" rel="noreferrer">
                    Open Externally
                  </a>
                  <button onClick={() => void copyUrl(entry)}>Copy URL</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {pendingImport && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) =>
            event.target === event.currentTarget && setPendingImport(undefined)
          }
        >
          <div
            className="source-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Import preview"
          >
            <div className="dialog-heading">
              <div>
                <span className="eyebrow">IMPORT PREVIEW</span>
                <h2>Merge Source Library</h2>
              </div>
              <button
                type="button"
                className="icon-button dialog-close"
                aria-label="Close import preview"
                onClick={() => setPendingImport(undefined)}
              >
                ×
              </button>
            </div>
            <div className="dialog-body">
              <dl className="import-preview">
                <div>
                  <dt>New sources</dt>
                  <dd>{pendingImport.preview.newSources}</dd>
                </div>
                <div>
                  <dt>Duplicates</dt>
                  <dd>{pendingImport.preview.duplicates}</dd>
                </div>
                <div>
                  <dt>Updated metadata</dt>
                  <dd>{pendingImport.preview.updatedMetadata}</dd>
                </div>
                <div>
                  <dt>New folders</dt>
                  <dd>{pendingImport.preview.newFolders}</dd>
                </div>
                <div>
                  <dt>Folder conflicts</dt>
                  <dd>{pendingImport.preview.conflictingFolders.join(', ') || 'None'}</dd>
                </div>
              </dl>
              <p>
                Active wall tiles will not be changed. A state backup is created before this merge.
              </p>
            </div>
            <div className="dialog-actions">
              <button className="secondary" onClick={() => setPendingImport(undefined)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    const result = await importLibrary(pendingImport.payload);
                    setPendingImport(undefined);
                    onFeedback(`Import complete. Backup: ${result.backupPath}`);
                  } catch (error) {
                    alert(error instanceof Error ? error.message : 'Import failed.');
                  }
                }}
              >
                Apply import
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
