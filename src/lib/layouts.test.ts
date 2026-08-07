import { describe, expect, it } from 'vitest';
import {
  activateAutomaticLayout,
  activateFreeformLayout,
  applyLayoutTemplate,
  automaticLayoutSlots,
  activeLayoutSlots,
  BUILT_IN_LAYOUTS,
  layoutOnlyState,
  normalizeLayoutSlots,
  normalizeFreeformLayout,
  normalizeLayoutTemplates,
  slotsOverlap,
  validateLayoutTemplate,
  wallLayoutForState,
} from './layouts';
import { emptyState, newTile } from './state';
import { detectSource } from './sources';

const tile = (name: string) =>
  newTile(name, detectSource(`https://mock.livewall.local/?label=${name}`));

describe('P3 layouts', () => {
  it.each(Array.from({ length: 9 }, (_, index) => index + 1))(
    'creates bounded, non-overlapping Auto geometry for %i tile(s)',
    (count) => {
      const slots = automaticLayoutSlots(count);
      expect(slots).toHaveLength(count);
      for (const [index, current] of slots.entries()) {
        expect(current.column).toBeGreaterThanOrEqual(1);
        expect(current.row).toBeGreaterThanOrEqual(1);
        expect(current.column + current.columnSpan - 1).toBeLessThanOrEqual(12);
        expect(current.row + current.rowSpan - 1).toBeLessThanOrEqual(12);
        for (const other of slots.slice(index + 1))
          expect(slotsOverlap(current, other)).toBe(false);
      }
      const state = {
        ...emptyState(),
        layoutMode: 'automatic' as const,
        tiles: Array.from({ length: count }, (_, index) => ({
          ...tile(String(index + 1)),
          id: `tile-${index + 1}`,
          displayOrder: index,
          x: index === 3 ? 0 : 99,
          y: index === 3 ? (null as unknown as number) : 99,
        })),
      };
      const wall = wallLayoutForState(state);
      expect(
        wall.map(({ i, x, y, w, h }) => ({
          id: i,
          column: x + 1,
          row: y + 1,
          columnSpan: w,
          rowSpan: h,
        })),
      ).toEqual(
        activeLayoutSlots(state).map((slot, index) => ({ ...slot, id: `tile-${index + 1}` })),
      );
    },
  );

  it('renders the four-tile Default preset as an ordered equal 2x2 grid', () => {
    expect(automaticLayoutSlots(4)).toEqual([
      { id: 'auto-1', column: 1, row: 1, columnSpan: 6, rowSpan: 6 },
      { id: 'auto-2', column: 7, row: 1, columnSpan: 6, rowSpan: 6 },
      { id: 'auto-3', column: 1, row: 7, columnSpan: 6, rowSpan: 6 },
      { id: 'auto-4', column: 7, row: 7, columnSpan: 6, rowSpan: 6 },
    ]);
  });

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

  it('retains valid Freeform coordinates independently, including intentional overlap', () => {
    expect(
      normalizeFreeformLayout([
        { id: 'one', column: 1, row: 1, columnSpan: 6, rowSpan: 6 },
        { id: 'two', column: 4, row: 4, columnSpan: 6, rowSpan: 6 },
      ]),
    ).toHaveLength(2);
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

  it('preserves independent Freeform and Custom coordinates while Auto is active', () => {
    const first = { ...tile('First'), id: 'first', x: 1, y: 2, w: 5, h: 4, displayOrder: 0 };
    const second = { ...tile('Second'), id: 'second', x: 7, y: 3, w: 4, h: 5, displayOrder: 1 };
    const freeform = { ...emptyState(), layoutMode: 'freeform' as const, tiles: [first, second] };
    const automatic = activateAutomaticLayout(freeform);
    expect(automatic.tiles).toEqual(freeform.tiles);
    expect(wallLayoutForState(automatic)).toMatchObject([
      { i: 'first', x: 0, y: 0, w: 6, h: 12 },
      { i: 'second', x: 6, y: 0, w: 6, h: 12 },
    ]);
    const custom = applyLayoutTemplate(automatic, BUILT_IN_LAYOUTS[2]);
    expect(custom.freeformLayout).toEqual(automatic.freeformLayout);
    expect(custom.layoutSlots).toEqual(BUILT_IN_LAYOUTS[2].slots);
    const backToAuto = activateAutomaticLayout(custom);
    expect(backToAuto.layoutSlots).toEqual(BUILT_IN_LAYOUTS[2].slots);
    const restored = activateFreeformLayout(backToAuto);
    expect(restored.tiles.map(({ x, y, w, h }) => ({ x, y, w, h }))).toEqual([
      { x: 1, y: 2, w: 5, h: 4 },
      { x: 7, y: 3, w: 4, h: 5 },
    ]);
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
    const current = {
      ...emptyState(),
      tiles: [currentTile],
      activeAudioTileId: currentTile.id,
      overlayMode: 'off' as const,
      appearance: { ...emptyState().appearance, backgroundColor: '#123456' },
    };
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
    expect(result.overlayMode).toBe('off');
    expect(result.appearance.backgroundColor).toBe('#123456');
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
