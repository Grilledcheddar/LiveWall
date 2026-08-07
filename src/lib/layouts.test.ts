import { describe, expect, it } from 'vitest';
import {
  applyLayoutTemplate,
  BUILT_IN_LAYOUTS,
  layoutOnlyState,
  normalizeLayoutSlots,
  normalizeLayoutTemplates,
  validateLayoutTemplate,
} from './layouts';
import { emptyState, newTile } from './state';
import { detectSource } from './sources';

const tile = (name: string) =>
  newTile(name, detectSource(`https://mock.livewall.local/?label=${name}`));

describe('P3 layouts', () => {
  it('validates every built-in template', () => {
    expect(BUILT_IN_LAYOUTS).toHaveLength(11);
    for (const template of BUILT_IN_LAYOUTS) expect(validateLayoutTemplate(template)).toBe(true);
  });

  it('rejects collisions, duplicates, zero spans, and out-of-range slots', () => {
    expect(
      normalizeLayoutSlots([
        { id: '1', column: 1, row: 1, columnSpan: 6, rowSpan: 6 },
        { id: '2', column: 5, row: 5, columnSpan: 4, rowSpan: 4 },
        { id: '1', column: 7, row: 1, columnSpan: 0, rowSpan: 6 },
        { id: '4', column: 13, row: 1, columnSpan: 1, rowSpan: 1 },
      ]),
    ).toHaveLength(1);
  });

  it('applies slots in display order without changing playback fields or tile IDs', () => {
    const first = { ...tile('First'), id: 'first', displayOrder: 1, volume: 21 };
    const second = { ...tile('Second'), id: 'second', displayOrder: 0, volume: 82 };
    const state = { ...emptyState(), tiles: [first, second], activeAudioTileId: 'first' };
    const result = applyLayoutTemplate(state, BUILT_IN_LAYOUTS[1]);
    expect(result.tiles.map(({ id, volume, source }) => ({ id, volume, source }))).toEqual(
      state.tiles.map(({ id, volume, source }) => ({ id, volume, source })),
    );
    expect(result.tiles.find((item) => item.id === 'second')).toMatchObject({ x: 0, w: 6 });
    expect(result.tiles.find((item) => item.id === 'first')).toMatchObject({ x: 6, w: 6 });
  });

  it('blocks layouts that cannot fit every tile', () => {
    expect(() =>
      applyLayoutTemplate(
        { ...emptyState(), tiles: [tile('one'), tile('two')] },
        BUILT_IN_LAYOUTS[0],
      ),
    ).toThrow(/would not fit/);
  });

  it('applies layout only without changing sources, queues, audio, or volumes', () => {
    const currentTile = {
      ...tile('Current'),
      queuedSource: detectSource('https://example.com/q.m3u8'),
      volume: 33,
    };
    const current = { ...emptyState(), tiles: [currentTile], activeAudioTileId: currentTile.id };
    const preset = applyLayoutTemplate(
      { ...emptyState(), tiles: [tile('Preset')] },
      BUILT_IN_LAYOUTS[0],
    );
    const result = layoutOnlyState(current, preset);
    expect(result.tiles[0]).toMatchObject({
      id: currentTile.id,
      source: currentTile.source,
      queuedSource: currentTile.queuedSource,
      volume: 33,
    });
    expect(result.activeAudioTileId).toBe(currentTile.id);
  });

  it('normalizes custom template names and invalid data', () => {
    const file = normalizeLayoutTemplates({
      templates: [
        {
          name: 'Custom',
          columns: 12,
          rows: 12,
          slots: [{ id: '1', column: 1, row: 1, columnSpan: 12, rowSpan: 12 }],
        },
        { name: 'custom', slots: [] },
        null,
      ],
    });
    expect(file.templates).toHaveLength(1);
  });
});
