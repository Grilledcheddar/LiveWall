import { normalizeWallState, orderedTiles } from './state.js';
import type { WallPreset, WallPresetFile, WallState } from './types.js';

export const WALL_PRESET_VERSION = 1 as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function snapshotWall(state: WallState): WallState {
  return normalizeWallState({
    ...structuredClone(state),
    focusedTileId: undefined,
    tiles: state.tiles.map((tile) => ({ ...tile, resumePosition: undefined })),
  });
}

export function normalizeWallPresets(value: unknown): WallPresetFile {
  const root = isRecord(value) ? value : {};
  const names = new Set<string>();
  const presets = (Array.isArray(root.presets) ? root.presets : []).flatMap(
    (candidate): WallPreset[] => {
      if (!isRecord(candidate) || typeof candidate.name !== 'string') return [];
      const name = candidate.name.trim().slice(0, 80);
      const key = name.toLocaleLowerCase();
      if (!name || names.has(key)) return [];
      try {
        const now = Date.now();
        names.add(key);
        return [
          {
            id:
              typeof candidate.id === 'string' && candidate.id ? candidate.id : crypto.randomUUID(),
            name,
            state: snapshotWall(candidate.state as WallState),
            createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
            updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : now,
          },
        ];
      } catch {
        return [];
      }
    },
  );
  return { format: 'livewall-wall-presets', version: WALL_PRESET_VERSION, presets };
}

export function createWallPreset(
  file: WallPresetFile,
  name: string,
  state: WallState,
  now = Date.now(),
) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a preset name.');
  if (
    file.presets.some((preset) => preset.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())
  )
    throw new Error('A wall preset with that name already exists.');
  return normalizeWallPresets({
    ...file,
    presets: [
      ...file.presets,
      {
        id: crypto.randomUUID(),
        name: trimmed,
        state: snapshotWall(state),
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

export function updateWallPreset(
  file: WallPresetFile,
  id: string,
  state: WallState,
  now = Date.now(),
) {
  if (!file.presets.some((preset) => preset.id === id)) throw new Error('Wall preset not found.');
  return normalizeWallPresets({
    ...file,
    presets: file.presets.map((preset) =>
      preset.id === id ? { ...preset, state: snapshotWall(state), updatedAt: now } : preset,
    ),
  });
}

export function renameWallPreset(file: WallPresetFile, id: string, name: string, now = Date.now()) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter a preset name.');
  if (
    file.presets.some(
      (preset) =>
        preset.id !== id && preset.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
    )
  )
    throw new Error('A wall preset with that name already exists.');
  return normalizeWallPresets({
    ...file,
    presets: file.presets.map((preset) =>
      preset.id === id ? { ...preset, name: trimmed, updatedAt: now } : preset,
    ),
  });
}

export function duplicateWallPreset(
  file: WallPresetFile,
  id: string,
  name: string,
  now = Date.now(),
) {
  const source = file.presets.find((preset) => preset.id === id);
  if (!source) throw new Error('Wall preset not found.');
  return createWallPreset(file, name, source.state, now);
}

export function deleteWallPreset(file: WallPresetFile, id: string) {
  return normalizeWallPresets({
    ...file,
    presets: file.presets.filter((preset) => preset.id !== id),
  });
}

export function workspaceDiff(state: WallState, preset: WallPreset) {
  const current = snapshotWall(state);
  const saved = snapshotWall(preset.state);
  const currentTiles = orderedTiles(current.tiles);
  const savedTiles = orderedTiles(saved.tiles);
  const details: string[] = [];
  if (currentTiles.length !== savedTiles.length)
    details.push(`Tile count: ${savedTiles.length} saved, ${currentTiles.length} current`);
  const sourceChanges = currentTiles.filter(
    (tile, index) => tile.source.url !== savedTiles[index]?.source.url,
  ).length;
  if (sourceChanges) details.push(`${sourceChanges} source slot(s) differ`);
  if (
    current.layoutMode !== saved.layoutMode ||
    JSON.stringify(current.layoutSlots) !== JSON.stringify(saved.layoutSlots)
  )
    details.push('Layout differs');
  if (JSON.stringify(current.appearance) !== JSON.stringify(saved.appearance))
    details.push('Appearance differs');
  if (
    currentTiles.some((tile, index) =>
      ['name', 'queuedSource', 'scheduledAt', 'volume', 'muted', 'playback'].some(
        (key) =>
          JSON.stringify(tile[key as keyof typeof tile]) !==
          JSON.stringify(savedTiles[index]?.[key as keyof typeof tile]),
      ),
    )
  )
    details.push('Playback, title, queue, timer, or audio settings differ');
  return { modified: details.length > 0, details };
}

export function presetPreview(preset: WallPreset, current: WallState) {
  return {
    id: preset.id,
    name: preset.name,
    updatedAt: preset.updatedAt,
    tileCount: preset.state.tiles.length,
    layoutMode: preset.state.layoutMode,
    sources: orderedTiles(preset.state.tiles).map((tile) => ({
      title: tile.name,
      url: tile.source.url,
      queued: tile.queuedSource?.url,
    })),
    difference: workspaceDiff(current, preset),
  };
}
