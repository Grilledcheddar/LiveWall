import type {
  OverlayMode,
  PlaybackStart,
  QueueEntry,
  Tile,
  VideoSource,
  WallAppearance,
  WallState,
} from './types.js';
import { emptyLibrary, normalizeSourceLibrary, recordLibraryUse } from './library.js';
import { normalizeFreeformLayout, normalizeLayoutSlots } from './layouts.js';
import { defaultStartBehavior, normalizePlaybackStart } from './playback.js';
import { normalizeQualityPreferences } from './quality.js';
import { detectSource } from './sources.js';
import { getEmbedPolicy } from './embed-policy.js';

export const DEFAULT_APPEARANCE: Readonly<WallAppearance> = Object.freeze({
  backgroundColor: '#020305',
  gap: 4,
  borderVisible: false,
  borderColor: '#303743',
  borderWidth: 1,
  cornerRadius: 0,
});

export const emptyState = (): WallState => ({
  schemaVersion: 5,
  version: 0,
  updatedAt: Date.now(),
  layoutMode: 'automatic',
  tiles: [],
  globallyStopped: false,
  overlayMode: 'hover',
  appearance: defaultAppearance(),
  library: emptyLibrary(),
  qualityPreferences: {},
});

export function defaultAppearance() {
  return { ...DEFAULT_APPEARANCE };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const validColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
const validNumber = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

export function normalizeAppearance(value: unknown): WallAppearance {
  const appearance = isRecord(value) ? value : {};
  return {
    backgroundColor: validColor(appearance.backgroundColor, DEFAULT_APPEARANCE.backgroundColor),
    gap: validNumber(appearance.gap, 0, 32, DEFAULT_APPEARANCE.gap),
    borderVisible:
      typeof appearance.borderVisible === 'boolean'
        ? appearance.borderVisible
        : DEFAULT_APPEARANCE.borderVisible,
    borderColor: validColor(appearance.borderColor, DEFAULT_APPEARANCE.borderColor),
    borderWidth: validNumber(appearance.borderWidth, 0, 8, DEFAULT_APPEARANCE.borderWidth),
    cornerRadius: validNumber(appearance.cornerRadius, 0, 32, DEFAULT_APPEARANCE.cornerRadius),
  };
}

export function normalizeOverlayMode(value: unknown): OverlayMode {
  return value === 'off' || value === 'always' || value === 'hover' ? value : 'hover';
}

export function newTile(
  name: string,
  source: VideoSource,
  titleMode: Tile['titleMode'] = 'manual',
): Tile {
  return {
    id: crypto.randomUUID(),
    name,
    titleMode,
    source,
    x: 0,
    y: Infinity,
    w: 4,
    h: 4,
    muted: true,
    volume: 70,
    displayOrder: 0,
    playback: defaultStartBehavior(source),
  };
}

function normalizeVideoSource(value: unknown, label: string): VideoSource {
  if (!isRecord(value) || typeof value.url !== 'string')
    throw new Error(`${label} has an invalid source.`);
  const type = String(value.type);
  if (!['youtube', 'youtube-playlist', 'hls', 'website', 'mock'].includes(type))
    throw new Error(`${label} has an unsupported source type.`);
  if (type === 'youtube' && typeof value.youtubeId !== 'string')
    throw new Error(`${label} is missing its YouTube video ID.`);
  if (type === 'youtube-playlist' && typeof value.playlistId !== 'string')
    throw new Error(`${label} is missing its YouTube playlist ID.`);
  let detected: VideoSource;
  try {
    detected = detectSource(value.url);
  } catch {
    throw new Error(`${label} has an unsafe URL.`);
  }
  const policy = type === 'website' ? getEmbedPolicy(detected) : undefined;
  return {
    url: detected.url,
    type: type as VideoSource['type'],
    youtubeId: type === 'youtube' ? String(value.youtubeId) : undefined,
    playlistId: type === 'youtube-playlist' ? String(value.playlistId) : undefined,
    playlistStartVideoId:
      type === 'youtube-playlist' && typeof value.playlistStartVideoId === 'string'
        ? value.playlistStartVideoId
        : undefined,
    playlistStartIndex:
      type === 'youtube-playlist' &&
      typeof value.playlistStartIndex === 'number' &&
      Number.isSafeInteger(value.playlistStartIndex) &&
      value.playlistStartIndex >= 0
        ? value.playlistStartIndex
        : undefined,
    embedProfile: policy?.externalOnly
      ? 'external'
      : type === 'website' &&
          ['safe', 'compatibility', 'external'].includes(String(value.embedProfile))
        ? (value.embedProfile as VideoSource['embedProfile'])
        : type === 'website'
          ? 'safe'
          : undefined,
    compatibilityConfirmed:
      !policy?.externalOnly && type === 'website' && value.compatibilityConfirmed === true
        ? true
        : undefined,
    embedReferrerPolicy:
      type === 'website' && value.embedReferrerPolicy === 'strict-origin-when-cross-origin'
        ? 'strict-origin-when-cross-origin'
        : type === 'website'
          ? 'no-referrer'
          : undefined,
  };
}

function queueStatus(source: VideoSource): Pick<QueueEntry, 'status' | 'reason'> {
  const policy = getEmbedPolicy(source);
  if (policy?.externalOnly) return { status: 'external-only', reason: policy.message };
  return { status: 'ready' };
}

function newQueueEntry(
  source: VideoSource,
  playback: PlaybackStart | undefined,
  title: string,
  titleMode: Tile['titleMode'],
  id: string = crypto.randomUUID(),
): QueueEntry {
  return {
    id,
    source,
    playback: normalizePlaybackStart(playback, source),
    title,
    titleMode: titleMode === 'auto' ? 'auto' : 'manual',
    ...queueStatus(source),
  };
}

function normalizeQueueEntry(value: unknown, label: string): QueueEntry | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const source = normalizeVideoSource(value.source, label);
    const title =
      typeof value.title === 'string' && value.title.trim()
        ? value.title.trim()
        : source.youtubeId || new URL(source.url).hostname;
    const normalized = newQueueEntry(
      source,
      value.playback as PlaybackStart | undefined,
      title,
      value.titleMode === 'auto' ? 'auto' : 'manual',
      typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
    );
    if (value.status === 'unsupported' && typeof value.reason === 'string')
      return { ...normalized, status: 'unsupported', reason: value.reason };
    return normalized;
  } catch {
    return undefined;
  }
}

function normalizeTileQueue(
  candidate: Record<string, unknown>,
  source: VideoSource,
  name: string,
  titleMode: Tile['titleMode'],
) {
  const supplied = Array.isArray(candidate.queue)
    ? candidate.queue
        .map((entry, index) => normalizeQueueEntry(entry, `Saved queue item ${index + 1}`))
        .filter((entry): entry is QueueEntry => Boolean(entry))
    : [];
  if (supplied.length) {
    const position =
      typeof candidate.queuePosition === 'number' && Number.isSafeInteger(candidate.queuePosition)
        ? Math.min(Math.max(0, candidate.queuePosition), supplied.length - 1)
        : 0;
    // The persisted source remains the player input; keep it synchronized to the active entry.
    const active = newQueueEntry(
      source,
      candidate.playback as PlaybackStart | undefined,
      name,
      titleMode,
      supplied[position].id,
    );
    supplied[position] = active;
    return { queue: supplied, queuePosition: position, source, playback: active.playback };
  }
  const current = newQueueEntry(
    source,
    candidate.playback as PlaybackStart | undefined,
    name,
    titleMode,
  );
  let legacy: QueueEntry | undefined;
  if (candidate.queuedSource) {
    try {
      const legacySource = normalizeVideoSource(candidate.queuedSource, 'Saved legacy queue item');
      legacy = newQueueEntry(
        legacySource,
        candidate.queuedPlayback as PlaybackStart | undefined,
        legacySource.youtubeId || new URL(legacySource.url).hostname,
        'manual',
      );
    } catch {
      legacy = undefined;
    }
  }
  return {
    queue: legacy ? [current, legacy] : [current],
    queuePosition: 0,
    source,
    playback: current.playback,
  };
}

function timelineForTile(tile: Tile): { queue: QueueEntry[]; position: number } {
  if (tile.queue?.length) {
    const position = Math.min(Math.max(0, tile.queuePosition ?? 0), tile.queue.length - 1);
    return { queue: tile.queue, position };
  }
  const current = newQueueEntry(tile.source, tile.playback, tile.name, tile.titleMode);
  if (!tile.queuedSource) return { queue: [current], position: 0 };
  return {
    queue: [
      current,
      newQueueEntry(
        tile.queuedSource,
        tile.queuedPlayback,
        tile.queuedSource.youtubeId || new URL(tile.queuedSource.url).hostname,
        'manual',
      ),
    ],
    position: 0,
  };
}

export function normalizeWallState(input: unknown): WallState {
  if (!isRecord(input) || !Array.isArray(input.tiles)) {
    throw new Error('Saved state has an invalid shape.');
  }
  if (!['automatic', 'freeform', 'template'].includes(String(input.layoutMode))) {
    throw new Error('Saved state has an invalid layout mode.');
  }
  const indexedTiles = input.tiles.map((candidate, index) => {
    if (!isRecord(candidate) || !isRecord(candidate.source)) {
      throw new Error(`Saved tile ${index + 1} has an invalid shape.`);
    }
    if (
      typeof candidate.id !== 'string' ||
      typeof candidate.name !== 'string' ||
      typeof candidate.source.url !== 'string' ||
      !['youtube', 'youtube-playlist', 'hls', 'website', 'mock'].includes(
        String(candidate.source.type),
      )
    ) {
      throw new Error(`Saved tile ${index + 1} is missing required playback fields.`);
    }
    const requestedOrder =
      typeof candidate.displayOrder === 'number' && Number.isFinite(candidate.displayOrder)
        ? candidate.displayOrder
        : index;
    const source = normalizeVideoSource(candidate.source, `Saved tile ${index + 1}`);
    const titleMode = candidate.titleMode === 'auto' ? ('auto' as const) : ('manual' as const);
    const queue = normalizeTileQueue(candidate, source, String(candidate.name), titleMode);
    return {
      index,
      requestedOrder,
      tile: {
        ...candidate,
        source: queue.source,
        queuedSource: undefined,
        queuedPlayback: undefined,
        queue: queue.queue,
        queuePosition: queue.queuePosition,
        playback: queue.playback,
        titleMode,
        displayOrder: requestedOrder,
        resumePosition:
          typeof candidate.resumePosition === 'number' &&
          Number.isFinite(candidate.resumePosition) &&
          candidate.resumePosition >= 0
            ? candidate.resumePosition
            : undefined,
      } as unknown as Tile,
    };
  });
  const normalizedOrders = new Map(
    [...indexedTiles]
      .sort((a, b) => a.requestedOrder - b.requestedOrder || a.index - b.index)
      .map((entry, index) => [entry.tile.id, index]),
  );
  const tiles = indexedTiles.map(({ tile }) => ({
    ...tile,
    displayOrder: normalizedOrders.get(tile.id)!,
  }));
  const tileIds = new Set(tiles.map((tile) => tile.id));
  return {
    ...input,
    schemaVersion: 5,
    version:
      typeof input.version === 'number' && Number.isFinite(input.version) ? input.version : 0,
    updatedAt:
      typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
        ? input.updatedAt
        : Date.now(),
    layoutMode: input.layoutMode as WallState['layoutMode'],
    tiles,
    activeAudioTileId:
      typeof input.activeAudioTileId === 'string' && tileIds.has(input.activeAudioTileId)
        ? input.activeAudioTileId
        : undefined,
    globallyStopped: typeof input.globallyStopped === 'boolean' ? input.globallyStopped : false,
    focusedTileId:
      typeof input.focusedTileId === 'string' && tileIds.has(input.focusedTileId)
        ? input.focusedTileId
        : undefined,
    overlayMode: normalizeOverlayMode(input.overlayMode),
    appearance: normalizeAppearance(input.appearance),
    library: normalizeSourceLibrary(input.library),
    activeLayoutId:
      typeof input.activeLayoutId === 'string' && input.activeLayoutId
        ? input.activeLayoutId
        : undefined,
    layoutSlots: normalizeLayoutSlots(input.layoutSlots, 12, 12),
    freeformLayout: normalizeFreeformLayout(input.freeformLayout, 12, 12),
    qualityPreferences: normalizeQualityPreferences(input.qualityPreferences),
  };
}

export const migrateState = normalizeWallState;

export function orderedTiles(tiles: Tile[]) {
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.tile.displayOrder) ? a.tile.displayOrder : a.index;
      const bOrder = Number.isFinite(b.tile.displayOrder) ? b.tile.displayOrder : b.index;
      return aOrder - bOrder || a.index - b.index;
    })
    .map(({ tile }) => tile);
}

export function moveTile(state: WallState, tileId: string, direction: -1 | 1): WallState {
  const ordered = orderedTiles(state.tiles);
  const from = ordered.findIndex((tile) => tile.id === tileId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ordered.length) return state;
  [ordered[from], ordered[to]] = [ordered[to], ordered[from]];
  const orders = new Map(ordered.map((tile, index) => [tile.id, index]));
  return {
    ...state,
    tiles: state.tiles.map((tile) => ({ ...tile, displayOrder: orders.get(tile.id)! })),
  };
}

export function reorderTile(state: WallState, tileId: string, beforeTileId: string): WallState {
  const ordered = orderedTiles(state.tiles);
  const from = ordered.findIndex((tile) => tile.id === tileId);
  const to = ordered.findIndex((tile) => tile.id === beforeTileId);
  if (from < 0 || to < 0 || from === to) return state;
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  const orders = new Map(ordered.map((tile, index) => [tile.id, index]));
  return {
    ...state,
    tiles: state.tiles.map((tile) => ({ ...tile, displayOrder: orders.get(tile.id)! })),
  };
}

export function replaceTileSource(
  state: WallState,
  tileId: string,
  replacement: Pick<Tile, 'name' | 'source' | 'titleMode'> & { playback?: PlaybackStart },
): WallState {
  return {
    ...state,
    tiles: state.tiles.map((tile) =>
      tile.id === tileId
        ? {
            ...tile,
            name: replacement.name,
            source: replacement.source,
            titleMode: replacement.titleMode,
            resumePosition: undefined,
            playback: normalizePlaybackStart(replacement.playback, replacement.source),
            playlistIndex: undefined,
          }
        : tile,
    ),
  };
}

export function automaticGrid(count: number): { columns: number; rows: number } {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return { columns: 3, rows: 2 };
  return { columns: 3, rows: 3 };
}

export function reconcileTimers(state: WallState, now = Date.now()): WallState {
  let changed = false;
  let library = state.library;
  const tiles = state.tiles.map((tile) => {
    const timeline = timelineForTile(tile);
    const nextEntry = timeline.queue[timeline.position + 1];
    if (nextEntry && tile.scheduledAt && tile.scheduledAt <= now) {
      changed = true;
      library = recordLibraryUse(library, nextEntry.source, nextEntry.title, 'manual', now);
      return {
        ...tile,
        source: nextEntry.source,
        playback: nextEntry.playback,
        queue: timeline.queue,
        queuePosition: timeline.position + 1,
        queuedSource: undefined,
        queuedPlayback: undefined,
        scheduledAt: undefined,
        playlistIndex: undefined,
      };
    }
    return tile;
  });
  return changed ? { ...state, tiles, library, updatedAt: now } : state;
}

export function recordSourceInState(
  state: WallState,
  source: VideoSource,
  title: string,
  titleMode: Tile['titleMode'] = 'manual',
  now = Date.now(),
): WallState {
  return {
    ...state,
    library: recordLibraryUse(state.library, source, title, titleMode, now),
  };
}

export function addSourceAsTile(
  state: WallState,
  source: VideoSource,
  title: string,
  titleMode: Tile['titleMode'] = 'manual',
  now = Date.now(),
): WallState {
  if (state.tiles.length >= 9) return state;
  const recorded = recordSourceInState(state, source, title, titleMode, now);
  return {
    ...recorded,
    tiles: [
      ...recorded.tiles,
      { ...newTile(title, source, titleMode), displayOrder: recorded.tiles.length },
    ],
  };
}

export function queueSourceForTile(
  state: WallState,
  tileId: string,
  source: VideoSource,
  title: string,
  titleMode: Tile['titleMode'] = 'manual',
  replaceExisting = false,
  now = Date.now(),
  playback?: PlaybackStart,
): WallState {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return state;
  const recorded = recordSourceInState(state, source, title, titleMode, now);
  return {
    ...recorded,
    tiles: recorded.tiles.map((candidate) =>
      candidate.id === tileId
        ? {
            ...candidate,
            queue: (() => {
              const timeline = timelineForTile(candidate);
              return replaceExisting
                ? [
                    ...timeline.queue.slice(0, timeline.position + 1),
                    newQueueEntry(source, playback, title, titleMode),
                  ]
                : [...timeline.queue, newQueueEntry(source, playback, title, titleMode)];
            })(),
            queuePosition: timelineForTile(candidate).position,
            queuedSource: undefined,
            queuedPlayback: undefined,
            scheduledAt: undefined,
          }
        : candidate,
    ),
  };
}

export function insertQueueSource(
  state: WallState,
  tileId: string,
  source: VideoSource,
  title: string,
  placement: 'next' | 'append',
  playback?: PlaybackStart,
  titleMode: Tile['titleMode'] = 'manual',
  now = Date.now(),
): WallState {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return state;
  const entry = newQueueEntry(source, playback, title, titleMode);
  const timeline = timelineForTile(tile);
  const index = placement === 'next' ? timeline.position + 1 : timeline.queue.length;
  const recorded = recordSourceInState(state, source, title, titleMode, now);
  return {
    ...recorded,
    tiles: recorded.tiles.map((candidate) => {
      if (candidate.id !== tileId) return candidate;
      const queue = [...timelineForTile(candidate).queue];
      queue.splice(index, 0, entry);
      return { ...candidate, queue, queuePosition: timelineForTile(candidate).position };
    }),
  };
}

export function playNowQueueSource(
  state: WallState,
  tileId: string,
  source: VideoSource,
  title: string,
  playback?: PlaybackStart,
  titleMode: Tile['titleMode'] = 'manual',
  now = Date.now(),
): WallState {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return state;
  const entry = newQueueEntry(source, playback, title, titleMode);
  const recorded = recordSourceInState(state, source, title, titleMode, now);
  return {
    ...recorded,
    tiles: recorded.tiles.map((candidate) => {
      if (candidate.id !== tileId) return candidate;
      const timeline = timelineForTile(candidate);
      const position = timeline.position;
      const queue = [...timeline.queue];
      queue[position] = entry;
      return {
        ...candidate,
        source,
        playback: entry.playback,
        queue,
        queuePosition: position,
        playlistIndex: undefined,
        resumePosition: undefined,
        scheduledAt: undefined,
      };
    }),
  };
}

export function moveQueueEntry(
  state: WallState,
  tileId: string,
  entryId: string,
  direction: -1 | 1,
): WallState {
  return {
    ...state,
    tiles: state.tiles.map((tile) => {
      if (tile.id !== tileId) return tile;
      const timeline = timelineForTile(tile);
      const index = timeline.queue.findIndex((entry) => entry.id === entryId);
      const target = index + direction;
      if (
        index <= timeline.position ||
        target <= timeline.position ||
        target >= timeline.queue.length
      )
        return tile;
      const queue = [...timeline.queue];
      [queue[index], queue[target]] = [queue[target], queue[index]];
      return { ...tile, queue };
    }),
  };
}

export function removeQueueEntry(state: WallState, tileId: string, entryId: string): WallState {
  return {
    ...state,
    tiles: state.tiles.map((tile) => {
      if (tile.id !== tileId) return tile;
      const timeline = timelineForTile(tile);
      const index = timeline.queue.findIndex((entry) => entry.id === entryId);
      if (index < 0 || index <= timeline.position) return tile;
      return { ...tile, queue: timeline.queue.filter((entry) => entry.id !== entryId) };
    }),
  };
}

export function clearRemainingQueue(state: WallState, tileId: string): WallState {
  return {
    ...state,
    tiles: state.tiles.map((tile) =>
      tile.id === tileId
        ? {
            ...tile,
            queue: timelineForTile(tile).queue.slice(0, timelineForTile(tile).position + 1),
            scheduledAt: undefined,
          }
        : tile,
    ),
  };
}

/** Advances only the target tile, skipping entries that cannot be played on the Wall. */
export function advanceQueueOnCompletion(
  state: WallState,
  tileId: string,
  now = Date.now(),
): WallState {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile) return state;
  const timeline = timelineForTile(tile);
  const index = timeline.queue.findIndex(
    (entry, candidateIndex) => candidateIndex > timeline.position && entry.status === 'ready',
  );
  if (index < 0) return state;
  const entry = timeline.queue[index];
  const recorded = recordSourceInState(state, entry.source, entry.title, entry.titleMode, now);
  return {
    ...recorded,
    tiles: recorded.tiles.map((candidate) =>
      candidate.id === tileId
        ? {
            ...candidate,
            source: entry.source,
            playback: entry.playback,
            queue: timeline.queue,
            queuePosition: index,
            resumePosition: undefined,
            playlistIndex: undefined,
            scheduledAt: undefined,
          }
        : candidate,
    ),
  };
}

export function playNextSource(state: WallState, tileId: string, now = Date.now()): WallState {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  const timeline = tile ? timelineForTile(tile) : undefined;
  const position = timeline?.position ?? 0;
  const nextEntry = timeline?.queue[position + 1];
  if (!tile || !nextEntry) return state;
  const next = recordSourceInState(state, nextEntry.source, nextEntry.title, 'manual', now);
  return {
    ...next,
    tiles: next.tiles.map((candidate) =>
      candidate.id === tileId
        ? {
            ...candidate,
            source: nextEntry.source,
            playback: nextEntry.playback,
            queuedSource: undefined,
            queuedPlayback: undefined,
            scheduledAt: undefined,
            queue: timeline!.queue,
            queuePosition: position + 1,
            resumePosition: undefined,
          }
        : candidate,
    ),
  };
}

export function selectActiveAudio(state: WallState, tileId?: string): WallState {
  return {
    ...state,
    activeAudioTileId: tileId,
    tiles: state.tiles.map((tile) => ({ ...tile, muted: tile.id !== tileId })),
  };
}
