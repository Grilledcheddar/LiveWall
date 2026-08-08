import { canonicalSourceUrl, detectSource } from './sources.js';
import { normalizePlaybackStart } from './playback.js';
import type {
  LibraryImportFile,
  LibrarySource,
  SourceFolder,
  SourceLibrary,
  VideoSource,
  PlaybackStart,
} from './types.js';

export const MAX_RECENT_SOURCES = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finiteTime = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
const id = () => crypto.randomUUID();

export const emptyLibrary = (): SourceLibrary => ({ version: 1, entries: [], folders: [] });

function safeSource(
  value: unknown,
): { source: VideoSource; originalUrl: string; canonicalUrl: string } | undefined {
  if (!isRecord(value)) return undefined;
  const originalUrl = typeof value.originalUrl === 'string' ? value.originalUrl : '';
  try {
    const detected = detectSource(originalUrl);
    const savedSource = isRecord(value.source) ? value.source : {};
    const source: VideoSource =
      detected.type === 'website'
        ? {
            ...detected,
            embedProfile: ['safe', 'compatibility', 'external'].includes(
              String(savedSource.embedProfile),
            )
              ? (savedSource.embedProfile as VideoSource['embedProfile'])
              : 'safe',
            compatibilityConfirmed: savedSource.compatibilityConfirmed === true || undefined,
            embedReferrerPolicy:
              savedSource.embedReferrerPolicy === 'strict-origin-when-cross-origin'
                ? 'strict-origin-when-cross-origin'
                : 'no-referrer',
          }
        : detected;
    return { source, originalUrl: source.url, canonicalUrl: canonicalSourceUrl(source) };
  } catch {
    return undefined;
  }
}

export function normalizeSourceLibrary(value: unknown, now = Date.now()): SourceLibrary {
  if (!isRecord(value)) return emptyLibrary();
  const rawFolders = Array.isArray(value.folders) ? value.folders : [];
  const folderNames = new Set<string>();
  const folderIds = new Set<string>();
  const folders: SourceFolder[] = [];
  rawFolders.forEach((candidate, index) => {
    if (!isRecord(candidate)) return;
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
    const candidateId = typeof candidate.id === 'string' && candidate.id ? candidate.id : id();
    if (
      !name ||
      name.length > 80 ||
      folderNames.has(name.toLocaleLowerCase()) ||
      folderIds.has(candidateId)
    )
      return;
    folderNames.add(name.toLocaleLowerCase());
    folderIds.add(candidateId);
    folders.push({
      id: candidateId,
      name,
      displayOrder:
        typeof candidate.displayOrder === 'number' && Number.isFinite(candidate.displayOrder)
          ? candidate.displayOrder
          : index,
      createdAt: finiteTime(candidate.createdAt, now),
      updatedAt: finiteTime(candidate.updatedAt, now),
    });
  });
  folders
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .forEach((folder, index) => (folder.displayOrder = index));

  const byCanonical = new Map<string, LibrarySource>();
  const rawEntries = Array.isArray(value.entries) ? value.entries : [];
  for (const candidate of rawEntries) {
    if (!isRecord(candidate)) continue;
    const parsed = safeSource(candidate);
    if (!parsed) continue;
    const title = typeof candidate.title === 'string' ? candidate.title.trim().slice(0, 160) : '';
    if (!title) continue;
    const favorite = candidate.favorite === true;
    const saved = candidate.saved === true || favorite;
    const recent = candidate.recent !== false;
    if (!saved && !recent) continue;
    const createdAt = finiteTime(candidate.createdAt, now);
    const updatedAt = finiteTime(candidate.updatedAt, createdAt);
    const lastUsedAt = finiteTime(candidate.lastUsedAt, updatedAt);
    const existing = byCanonical.get(parsed.canonicalUrl);
    const entry: LibrarySource = {
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : id(),
      ...parsed,
      title,
      titleMode:
        candidate.titleMode === 'auto' && parsed.source.type === 'youtube' ? 'auto' : 'manual',
      saved,
      favorite,
      recent,
      folderId:
        saved && typeof candidate.folderId === 'string' && folderIds.has(candidate.folderId)
          ? candidate.folderId
          : undefined,
      hostname: new URL(parsed.originalUrl).hostname,
      createdAt,
      updatedAt,
      lastUsedAt,
      useCount:
        typeof candidate.useCount === 'number' &&
        Number.isInteger(candidate.useCount) &&
        candidate.useCount > 0
          ? candidate.useCount
          : 1,
      playback: normalizePlaybackStart(candidate.playback, parsed.source),
    };
    if (!existing || entry.updatedAt >= existing.updatedAt)
      byCanonical.set(entry.canonicalUrl, entry);
  }
  let entries = [...byCanonical.values()];
  const recent = entries
    .filter((entry) => entry.recent)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  const retainedRecent = new Set(recent.slice(0, MAX_RECENT_SOURCES).map((entry) => entry.id));
  entries = entries
    .map((entry) =>
      entry.recent && !retainedRecent.has(entry.id) ? { ...entry, recent: false } : entry,
    )
    .filter((entry) => entry.saved || entry.recent)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt || a.title.localeCompare(b.title));
  return { version: 1, entries, folders };
}

export function recordLibraryUse(
  library: SourceLibrary,
  source: VideoSource,
  title: string,
  titleMode: 'auto' | 'manual' = 'manual',
  now = Date.now(),
  playback?: PlaybackStart,
): SourceLibrary {
  const normalized = normalizeSourceLibrary(library, now);
  const canonicalUrl = canonicalSourceUrl(source);
  const existing = normalized.entries.find((entry) => entry.canonicalUrl === canonicalUrl);
  const entry: LibrarySource = existing
    ? {
        ...existing,
        originalUrl: source.url,
        source,
        title: title.trim() || existing.title,
        titleMode: titleMode === 'auto' && source.type === 'youtube' ? 'auto' : 'manual',
        recent: true,
        updatedAt: now,
        lastUsedAt: now,
        useCount: existing.useCount + 1,
        playback: normalizePlaybackStart(playback ?? existing.playback, source),
      }
    : {
        id: id(),
        originalUrl: source.url,
        canonicalUrl,
        source,
        title: title.trim() || new URL(source.url).hostname,
        titleMode: titleMode === 'auto' && source.type === 'youtube' ? 'auto' : 'manual',
        saved: false,
        favorite: false,
        recent: true,
        hostname: new URL(source.url).hostname,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        useCount: 1,
        playback: normalizePlaybackStart(playback, source),
      };
  return normalizeSourceLibrary(
    {
      ...normalized,
      entries: [...normalized.entries.filter((item) => item.canonicalUrl !== canonicalUrl), entry],
    },
    now,
  );
}

export function saveLibrarySource(
  library: SourceLibrary,
  source: VideoSource,
  title: string,
  titleMode: 'auto' | 'manual' = 'manual',
  now = Date.now(),
  playback?: PlaybackStart,
): SourceLibrary {
  const normalized = normalizeSourceLibrary(library, now);
  const canonicalUrl = canonicalSourceUrl(source);
  const existing = normalized.entries.find((entry) => entry.canonicalUrl === canonicalUrl);
  const entry: LibrarySource = existing
    ? {
        ...existing,
        originalUrl: source.url,
        source,
        title: title.trim() || existing.title,
        titleMode: titleMode === 'auto' && source.type === 'youtube' ? 'auto' : 'manual',
        saved: true,
        updatedAt: now,
        playback: normalizePlaybackStart(playback ?? existing.playback, source),
      }
    : {
        id: id(),
        originalUrl: source.url,
        canonicalUrl,
        source,
        title: title.trim() || new URL(source.url).hostname,
        titleMode: titleMode === 'auto' && source.type === 'youtube' ? 'auto' : 'manual',
        saved: true,
        favorite: false,
        recent: false,
        hostname: new URL(source.url).hostname,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: now,
        useCount: 1,
        playback: normalizePlaybackStart(playback, source),
      };
  return normalizeSourceLibrary(
    {
      ...normalized,
      entries: [...normalized.entries.filter((item) => item.canonicalUrl !== canonicalUrl), entry],
    },
    now,
  );
}

export function clearLibraryRecents(library: SourceLibrary): SourceLibrary {
  const normalized = normalizeSourceLibrary(library);
  return normalizeSourceLibrary({
    ...normalized,
    entries: normalized.entries
      .filter((entry) => entry.saved)
      .map((entry) => ({ ...entry, recent: false, folderId: entry.folderId })),
  });
}

export function setLibraryFavorite(
  library: SourceLibrary,
  entryId: string,
  favorite: boolean,
  now = Date.now(),
): SourceLibrary {
  const normalized = normalizeSourceLibrary(library, now);
  const entry = normalized.entries.find((candidate) => candidate.id === entryId);
  if (!entry?.saved) return normalized;
  return normalizeSourceLibrary({
    ...normalized,
    entries: normalized.entries.map((entry) =>
      entry.id === entryId ? { ...entry, favorite, updatedAt: now } : entry,
    ),
  });
}

export function updateLibraryEntry(
  library: SourceLibrary,
  entryId: string,
  change: Pick<Partial<LibrarySource>, 'title' | 'titleMode' | 'folderId' | 'source'>,
  now = Date.now(),
): SourceLibrary {
  return normalizeSourceLibrary({
    ...library,
    entries: library.entries.map((entry) =>
      entry.id === entryId ? { ...entry, ...change, updatedAt: now } : entry,
    ),
  });
}

function validatedFolderName(library: SourceLibrary, name: string, exceptId?: string) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new Error('Folder names must be 1–80 characters.');
  if (
    library.folders.some(
      (folder) =>
        folder.id !== exceptId && folder.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
    )
  )
    throw new Error('Folder names must be unique.');
  return trimmed;
}

export function createLibraryFolder(library: SourceLibrary, name: string, now = Date.now()) {
  const normalized = normalizeSourceLibrary(library, now);
  return normalizeSourceLibrary(
    {
      ...normalized,
      folders: [
        ...normalized.folders,
        {
          id: id(),
          name: validatedFolderName(normalized, name),
          displayOrder: normalized.folders.length,
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    now,
  );
}

export function renameLibraryFolder(
  library: SourceLibrary,
  folderId: string,
  name: string,
  now = Date.now(),
) {
  const normalized = normalizeSourceLibrary(library, now);
  const validName = validatedFolderName(normalized, name, folderId);
  return normalizeSourceLibrary(
    {
      ...normalized,
      folders: normalized.folders.map((folder) =>
        folder.id === folderId ? { ...folder, name: validName, updatedAt: now } : folder,
      ),
    },
    now,
  );
}

export function moveLibraryFolder(library: SourceLibrary, folderId: string, direction: -1 | 1) {
  const normalized = normalizeSourceLibrary(library);
  const folders = [...normalized.folders];
  const from = folders.findIndex((folder) => folder.id === folderId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= folders.length) return normalized;
  [folders[from], folders[to]] = [folders[to], folders[from]];
  return normalizeSourceLibrary({
    ...normalized,
    folders: folders.map((folder, index) => ({ ...folder, displayOrder: index })),
  });
}

export function deleteLibraryFolder(library: SourceLibrary, folderId: string) {
  return normalizeSourceLibrary({
    ...library,
    folders: library.folders.filter((folder) => folder.id !== folderId),
    entries: library.entries.map((entry) =>
      entry.folderId === folderId ? { ...entry, folderId: undefined } : entry,
    ),
  });
}

export type LibraryFilter = 'all' | 'saved' | 'favorites' | 'recents';
export type LibrarySort = 'recent' | 'name' | 'used';

export function selectLibraryEntries(
  library: SourceLibrary,
  options: {
    search?: string;
    filter?: LibraryFilter;
    type?: string;
    folderId?: string;
    sort?: LibrarySort;
  },
) {
  const search = (options.search ?? '').trim().toLocaleLowerCase();
  const folderNames = new Map(library.folders.map((folder) => [folder.id, folder.name]));
  return library.entries
    .filter((entry) => options.filter !== 'saved' || entry.saved)
    .filter((entry) => options.filter !== 'favorites' || entry.favorite)
    .filter((entry) => options.filter !== 'recents' || entry.recent)
    .filter(
      (entry) => !options.type || options.type === 'all' || entry.source.type === options.type,
    )
    .filter(
      (entry) =>
        !options.folderId ||
        options.folderId === 'all' ||
        (options.folderId === 'unfiled' ? !entry.folderId : entry.folderId === options.folderId),
    )
    .filter(
      (entry) =>
        !search ||
        [
          entry.title,
          entry.originalUrl,
          entry.hostname,
          entry.folderId ? folderNames.get(entry.folderId) : 'Unfiled',
        ].some((value) => value?.toLocaleLowerCase().includes(search)),
    )
    .sort((a, b) =>
      options.sort === 'name'
        ? a.title.localeCompare(b.title)
        : options.sort === 'used'
          ? b.useCount - a.useCount || b.lastUsedAt - a.lastUsedAt
          : b.lastUsedAt - a.lastUsedAt,
    );
}

export function exportLibrary(library: SourceLibrary, now = Date.now()): LibraryImportFile {
  return {
    format: 'livewall-source-library',
    version: 1,
    exportedAt: now,
    library: normalizeSourceLibrary(library, now),
  };
}

export interface LibraryImportPreview {
  incoming: SourceLibrary;
  newSources: number;
  duplicates: number;
  updatedMetadata: number;
  newFolders: number;
  conflictingFolders: string[];
}

export function previewLibraryImport(current: SourceLibrary, value: unknown): LibraryImportPreview {
  if (
    !isRecord(value) ||
    value.format !== 'livewall-source-library' ||
    value.version !== 1 ||
    !isRecord(value.library)
  ) {
    throw new Error('This is not a valid LiveWall Source Library export.');
  }
  const rawEntries = Array.isArray(value.library.entries) ? value.library.entries : [];
  if (
    rawEntries.some(
      (entry) =>
        !isRecord(entry) ||
        !safeSource(entry) ||
        typeof entry.title !== 'string' ||
        !entry.title.trim() ||
        entry.title.length > 160,
    )
  )
    throw new Error('The import contains an invalid or unsafe source URL.');
  const rawFolders = Array.isArray(value.library.folders) ? value.library.folders : [];
  if (
    rawFolders.some(
      (folder) =>
        !isRecord(folder) ||
        typeof folder.name !== 'string' ||
        !folder.name.trim() ||
        folder.name.length > 80,
    )
  )
    throw new Error('The import contains an invalid folder.');
  const incoming = normalizeSourceLibrary(value.library);
  const currentCanonicals = new Set(current.entries.map((entry) => entry.canonicalUrl));
  const currentFolders = new Map(
    current.folders.map((folder) => [folder.name.toLocaleLowerCase(), folder]),
  );
  const duplicates = incoming.entries.filter((entry) => currentCanonicals.has(entry.canonicalUrl));
  const conflicts = incoming.folders.filter((folder) =>
    currentFolders.has(folder.name.toLocaleLowerCase()),
  );
  return {
    incoming,
    newSources: incoming.entries.length - duplicates.length,
    duplicates: duplicates.length,
    updatedMetadata: duplicates.filter((entry) => {
      const existing = current.entries.find((item) => item.canonicalUrl === entry.canonicalUrl);
      return Boolean(existing && existing.updatedAt < entry.updatedAt);
    }).length,
    newFolders: incoming.folders.length - conflicts.length,
    conflictingFolders: conflicts.map((folder) => folder.name),
  };
}

export function mergeLibraryImport(
  current: SourceLibrary,
  preview: LibraryImportPreview,
): SourceLibrary {
  const now = Date.now();
  const folders = [...current.folders];
  const folderMap = new Map<string, string>();
  for (const incoming of preview.incoming.folders) {
    const existing = folders.find(
      (folder) => folder.name.toLocaleLowerCase() === incoming.name.toLocaleLowerCase(),
    );
    if (existing) folderMap.set(incoming.id, existing.id);
    else {
      const next = {
        ...incoming,
        id: id(),
        displayOrder: folders.length,
        createdAt: now,
        updatedAt: now,
      };
      folders.push(next);
      folderMap.set(incoming.id, next.id);
    }
  }
  const byCanonical = new Map(current.entries.map((entry) => [entry.canonicalUrl, entry]));
  for (const incoming of preview.incoming.entries) {
    const existing = byCanonical.get(incoming.canonicalUrl);
    const folderId = incoming.folderId ? folderMap.get(incoming.folderId) : undefined;
    if (!existing) byCanonical.set(incoming.canonicalUrl, { ...incoming, id: id(), folderId });
    else if (incoming.updatedAt > existing.updatedAt) {
      byCanonical.set(incoming.canonicalUrl, {
        ...existing,
        title: incoming.title,
        titleMode: incoming.titleMode,
        saved: existing.saved || incoming.saved,
        favorite: existing.favorite || incoming.favorite,
        folderId: incoming.saved ? folderId : existing.folderId,
        updatedAt: incoming.updatedAt,
      });
    }
  }
  return normalizeSourceLibrary({ version: 1, folders, entries: [...byCanonical.values()] });
}
