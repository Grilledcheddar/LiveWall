import type {
  OverlayMode,
  PlaybackStart,
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

export const DEFAULT_APPEARANCE: Readonly<WallAppearance> = Object.freeze({
  backgroundColor: '#020305',
  gap: 4,
  borderVisible: false,
  borderColor: '#303743',
  borderWidth: 1,
  cornerRadius: 0,
});

export const emptyState = (): WallState => ({
  schemaVersion: 4,
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
    embedProfile:
      type === 'website' &&
      ['safe', 'compatibility', 'external'].includes(String(value.embedProfile))
        ? (value.embedProfile as VideoSource['embedProfile'])
        : type === 'website'
          ? 'safe'
          : undefined,
    compatibilityConfirmed:
      type === 'website' && value.compatibilityConfirmed === true ? true : undefined,
    embedReferrerPolicy:
      type === 'website' && value.embedReferrerPolicy === 'strict-origin-when-cross-origin'
        ? 'strict-origin-when-cross-origin'
        : type === 'website'
          ? 'no-referrer'
          : undefined,
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
    const queuedSource = candidate.queuedSource
      ? normalizeVideoSource(candidate.queuedSource, `Saved tile ${index + 1} queue`)
      : undefined;
    return {
      index,
      requestedOrder,
      tile: {
        ...candidate,
        source,
        queuedSource,
        queuedPlayback: queuedSource
          ? normalizePlaybackStart(candidate.queuedPlayback, queuedSource)
          : undefined,
        playback: normalizePlaybackStart(candidate.playback, source),
        titleMode: candidate.titleMode === 'auto' ? ('auto' as const) : ('manual' as const),
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
    schemaVersion: 4,
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
    if (tile.queuedSource && tile.scheduledAt && tile.scheduledAt <= now) {
      changed = true;
      library = recordLibraryUse(
        library,
        tile.queuedSource,
        tile.queuedSource.youtubeId || new URL(tile.queuedSource.url).hostname,
        'manual',
        now,
      );
      return {
        ...tile,
        source: tile.queuedSource,
        playback: normalizePlaybackStart(tile.queuedPlayback, tile.queuedSource),
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
  if (!tile || (tile.queuedSource && !replaceExisting)) return state;
  const recorded = recordSourceInState(state, source, title, titleMode, now);
  return {
    ...recorded,
    tiles: recorded.tiles.map((candidate) =>
      candidate.id === tileId
        ? {
            ...candidate,
            queuedSource: source,
            queuedPlayback: normalizePlaybackStart(playback, source),
            scheduledAt: undefined,
          }
        : candidate,
    ),
  };
}

export function playNextSource(state: WallState, tileId: string, now = Date.now()): WallState {
  const tile = state.tiles.find((candidate) => candidate.id === tileId);
  if (!tile?.queuedSource) return state;
  const next = recordSourceInState(
    state,
    tile.queuedSource,
    tile.queuedSource.youtubeId || new URL(tile.queuedSource.url).hostname,
    'manual',
    now,
  );
  return {
    ...next,
    tiles: next.tiles.map((candidate) =>
      candidate.id === tileId
        ? {
            ...candidate,
            source: candidate.queuedSource!,
            playback: normalizePlaybackStart(candidate.queuedPlayback, candidate.queuedSource!),
            queuedSource: undefined,
            queuedPlayback: undefined,
            scheduledAt: undefined,
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
