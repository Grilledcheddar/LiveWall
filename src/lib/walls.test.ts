import { describe, expect, it } from 'vitest';
import { emptyState, newTile } from './state';
import { detectSource } from './sources';
import {
  createWallPreset,
  deleteWallPreset,
  duplicateWallPreset,
  normalizeWallPresets,
  presetPreview,
  renameWallPreset,
  snapshotWall,
  updateWallPreset,
  workspaceDiff,
} from './walls';

const workspace = () => ({
  ...emptyState(),
  focusedTileId: 'temporary',
  tiles: [
    {
      ...newTile('Camera', detectSource('https://mock.livewall.local/?label=camera')),
      resumePosition: 42,
    },
  ],
});

describe('P3 named walls', () => {
  it('creates, previews, updates, saves as, renames, duplicates, and deletes', () => {
    let file = normalizeWallPresets(undefined);
    file = createWallPreset(file, 'Operations', workspace(), 1);
    const id = file.presets[0].id;
    expect(presetPreview(file.presets[0], workspace()).tileCount).toBe(1);
    file = updateWallPreset(file, id, { ...workspace(), overlayMode: 'always' }, 2);
    expect(file.presets[0].updatedAt).toBe(2);
    file = createWallPreset(file, 'Backup', workspace(), 3);
    file = renameWallPreset(file, id, 'Main', 4);
    file = duplicateWallPreset(file, id, 'Main copy', 5);
    expect(file.presets.map((preset) => preset.name)).toEqual(['Main', 'Backup', 'Main copy']);
    file = deleteWallPreset(file, id);
    expect(file.presets.map((preset) => preset.name)).toEqual(['Backup', 'Main copy']);
  });

  it('does not snapshot focus or embedded resume positions', () => {
    const snapshot = snapshotWall(workspace());
    expect(snapshot.focusedTileId).toBeUndefined();
    expect(snapshot.tiles[0].resumePosition).toBeUndefined();
  });

  it('keeps presets unchanged when the live workspace changes and detects modifications', () => {
    const preset = createWallPreset(normalizeWallPresets(undefined), 'Saved', workspace())
      .presets[0];
    const changed = { ...workspace(), tiles: [{ ...workspace().tiles[0], volume: 10 }] };
    expect(workspaceDiff(changed, preset)).toMatchObject({ modified: true });
    expect(preset.state.tiles[0].volume).toBe(70);
  });

  it('recovers malformed, null, and partial preset files', () => {
    expect(normalizeWallPresets(null).presets).toEqual([]);
    expect(normalizeWallPresets({ presets: [null, { name: '', state: {} }] }).presets).toEqual([]);
  });
});
