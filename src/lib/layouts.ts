import type { LayoutSlot, LayoutTemplate, LayoutTemplateFile, WallState } from './types.js';
import { orderedTiles } from './state.js';

export const LAYOUT_TEMPLATE_VERSION = 1 as const;

const slot = (
  id: string,
  column: number,
  row: number,
  columnSpan: number,
  rowSpan: number,
): LayoutSlot => ({ id, column, row, columnSpan, rowSpan });

const builtIn = (id: string, name: string, slots: LayoutSlot[], rows = 12): LayoutTemplate => ({
  id,
  name,
  builtIn: true,
  columns: 12,
  rows,
  slots,
  createdAt: 0,
  updatedAt: 0,
});

export const BUILT_IN_LAYOUTS: readonly LayoutTemplate[] = Object.freeze([
  builtIn('single', 'Single tile', [slot('1', 1, 1, 12, 12)]),
  builtIn('two-side', 'Two side-by-side', [slot('1', 1, 1, 6, 12), slot('2', 7, 1, 6, 12)]),
  builtIn('two-rows', 'Two wide rows', [slot('1', 1, 1, 12, 6), slot('2', 1, 7, 12, 6)]),
  builtIn('four-equal', 'Four equal tiles', [
    slot('1', 1, 1, 6, 6),
    slot('2', 7, 1, 6, 6),
    slot('3', 1, 7, 6, 6),
    slot('4', 7, 7, 6, 6),
  ]),
  builtIn('large-left', 'Large left with two stacked right', [
    slot('1', 1, 1, 8, 12),
    slot('2', 9, 1, 4, 6),
    slot('3', 9, 7, 4, 6),
  ]),
  builtIn('wide-top', 'Wide top with two tiles below', [
    slot('1', 1, 1, 12, 7),
    slot('2', 1, 8, 6, 5),
    slot('3', 7, 8, 6, 5),
  ]),
  builtIn('wide-bottom', 'Two tiles above with a wide bottom', [
    slot('1', 1, 1, 6, 5),
    slot('2', 7, 1, 6, 5),
    slot('3', 1, 6, 12, 7),
  ]),
  builtIn('large-top-four', 'Large top with three smaller tiles below', [
    slot('1', 1, 1, 12, 7),
    slot('2', 1, 8, 4, 5),
    slot('3', 5, 8, 4, 5),
    slot('4', 9, 8, 4, 5),
  ]),
  builtIn('three-columns', 'Three equal columns', [
    slot('1', 1, 1, 4, 12),
    slot('2', 5, 1, 4, 12),
    slot('3', 9, 1, 4, 12),
  ]),
  builtIn(
    'six-grid',
    'Six-tile grid',
    Array.from({ length: 6 }, (_, index) =>
      slot(String(index + 1), (index % 3) * 4 + 1, Math.floor(index / 3) * 6 + 1, 4, 6),
    ),
  ),
  builtIn(
    'nine-grid',
    'Nine-tile grid',
    Array.from({ length: 9 }, (_, index) =>
      slot(String(index + 1), (index % 3) * 4 + 1, Math.floor(index / 3) * 4 + 1, 4, 4),
    ),
  ),
]);

export function automaticLayoutSlots(count: number): LayoutSlot[] {
  const safeCount = Math.min(9, Math.max(0, Math.floor(count)));
  if (!safeCount) return [];
  if (safeCount === 1) return [slot('auto-1', 1, 1, 12, 12)];
  if (safeCount === 2) return [slot('auto-1', 1, 1, 6, 12), slot('auto-2', 7, 1, 6, 12)];
  if (safeCount === 3)
    return [slot('auto-1', 1, 1, 12, 6), slot('auto-2', 1, 7, 6, 6), slot('auto-3', 7, 7, 6, 6)];
  const columns = safeCount <= 4 ? 2 : 3;
  const rows = safeCount <= 6 ? 2 : 3;
  const width = 12 / columns;
  const height = 12 / rows;
  return Array.from({ length: safeCount }, (_, index) =>
    slot(
      `auto-${index + 1}`,
      (index % columns) * width + 1,
      Math.floor(index / columns) * height + 1,
      width,
      height,
    ),
  );
}

function freeformSlots(state: WallState): LayoutSlot[] {
  return orderedTiles(state.tiles).map((tile) => ({
    id: tile.id,
    column: Number.isFinite(tile.x) ? tile.x + 1 : 1,
    row: Number.isFinite(tile.y) ? tile.y + 1 : 1,
    columnSpan: Number.isFinite(tile.w) && tile.w > 0 ? tile.w : 1,
    rowSpan: Number.isFinite(tile.h) && tile.h > 0 ? tile.h : 1,
  }));
}

export function activeLayoutSlots(state: WallState): LayoutSlot[] {
  const tiles = orderedTiles(state.tiles);
  if (state.layoutMode === 'automatic') return automaticLayoutSlots(tiles.length);
  if (state.layoutMode === 'template' && (state.layoutSlots?.length ?? 0) >= tiles.length)
    return state.layoutSlots!.slice(0, tiles.length);
  return freeformSlots(state);
}

export function wallLayoutForState(state: WallState) {
  const tiles = orderedTiles(state.tiles);
  const slots = activeLayoutSlots(state);
  return tiles.map((tile, index) => {
    const assigned = slots[index];
    return {
      i: tile.id,
      x: assigned.column - 1,
      y: assigned.row - 1,
      w: assigned.columnSpan,
      h: assigned.rowSpan,
    };
  });
}

export function activateAutomaticLayout(state: WallState): WallState {
  return {
    ...state,
    layoutMode: 'automatic',
    freeformLayout: state.layoutMode === 'freeform' ? freeformSlots(state) : state.freeformLayout,
  };
}

export function activateFreeformLayout(state: WallState): WallState {
  const positions = new Map(
    (state.freeformLayout ?? []).map((saved) => [
      saved.id,
      {
        x: saved.column - 1,
        y: saved.row - 1,
        w: saved.columnSpan,
        h: saved.rowSpan,
      },
    ]),
  );
  return {
    ...state,
    layoutMode: 'freeform',
    tiles: state.tiles.map((tile) => ({ ...tile, ...positions.get(tile.id) })),
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value) ? value : fallback;

export function normalizeLayoutSlots(value: unknown, columns = 12, rows = 12): LayoutSlot[] {
  if (!Array.isArray(value)) return [];
  const result: LayoutSlot[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) continue;
    const next: LayoutSlot = {
      id:
        typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : String(index + 1),
      column: integer(candidate.column, 1),
      row: integer(candidate.row, 1),
      columnSpan: integer(candidate.columnSpan, 1),
      rowSpan: integer(candidate.rowSpan, 1),
    };
    if (
      next.column < 1 ||
      next.row < 1 ||
      next.columnSpan < 1 ||
      next.rowSpan < 1 ||
      next.column + next.columnSpan - 1 > columns ||
      next.row + next.rowSpan - 1 > rows ||
      result.some((existing) => existing.id === next.id || slotsOverlap(existing, next))
    )
      continue;
    result.push(next);
    if (result.length === 9) break;
  }
  return result;
}

export function normalizeFreeformLayout(value: unknown, columns = 12, rows = 12): LayoutSlot[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.flatMap((candidate, index): LayoutSlot[] => {
    if (!isRecord(candidate)) return [];
    const next: LayoutSlot = {
      id:
        typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : String(index + 1),
      column: integer(candidate.column, 1),
      row: integer(candidate.row, 1),
      columnSpan: integer(candidate.columnSpan, 1),
      rowSpan: integer(candidate.rowSpan, 1),
    };
    if (
      ids.has(next.id) ||
      next.column < 1 ||
      next.row < 1 ||
      next.columnSpan < 1 ||
      next.rowSpan < 1 ||
      next.column + next.columnSpan - 1 > columns ||
      next.row + next.rowSpan - 1 > rows
    )
      return [];
    ids.add(next.id);
    return [next];
  });
}

export function slotsOverlap(first: LayoutSlot, second: LayoutSlot) {
  return !(
    first.column + first.columnSpan <= second.column ||
    second.column + second.columnSpan <= first.column ||
    first.row + first.rowSpan <= second.row ||
    second.row + second.rowSpan <= first.row
  );
}

export function validateLayoutTemplate(template: LayoutTemplate) {
  const normalized = normalizeLayoutSlots(template.slots, template.columns, template.rows);
  return (
    template.name.trim().length > 0 &&
    template.columns >= 1 &&
    template.columns <= 24 &&
    template.rows >= 1 &&
    template.rows <= 24 &&
    normalized.length === template.slots.length &&
    normalized.length > 0
  );
}

export function normalizeLayoutTemplates(value: unknown): LayoutTemplateFile {
  const root = isRecord(value) ? value : {};
  const names = new Set<string>();
  const templates = (Array.isArray(root.templates) ? root.templates : []).flatMap(
    (candidate): LayoutTemplate[] => {
      if (!isRecord(candidate) || typeof candidate.name !== 'string') return [];
      const name = candidate.name.trim().slice(0, 80);
      const key = name.toLocaleLowerCase();
      if (!name || names.has(key)) return [];
      const columns = Math.min(24, Math.max(1, integer(candidate.columns, 12)));
      const rows = Math.min(24, Math.max(1, integer(candidate.rows, 12)));
      const slots = normalizeLayoutSlots(candidate.slots, columns, rows);
      if (!slots.length) return [];
      names.add(key);
      const now = Date.now();
      return [
        {
          id: typeof candidate.id === 'string' && candidate.id ? candidate.id : crypto.randomUUID(),
          name,
          builtIn: false,
          columns,
          rows,
          slots,
          appearance: isRecord(candidate.appearance) ? candidate.appearance : undefined,
          createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : now,
          updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : now,
        },
      ];
    },
  );
  return { format: 'livewall-layout-templates', version: LAYOUT_TEMPLATE_VERSION, templates };
}

export function applyLayoutTemplate(state: WallState, template: LayoutTemplate): WallState {
  const tiles = orderedTiles(state.tiles);
  if (tiles.length > template.slots.length)
    throw new Error(`${tiles.length - template.slots.length} tile(s) would not fit this layout.`);
  const positions = new Map(
    tiles.map((tile, index) => {
      const assigned = template.slots[index];
      return [
        tile.id,
        {
          x: assigned.column - 1,
          y: assigned.row - 1,
          w: assigned.columnSpan,
          h: assigned.rowSpan,
        },
      ];
    }),
  );
  return {
    ...state,
    freeformLayout:
      state.layoutMode === 'freeform' ||
      (state.layoutMode === 'automatic' && !state.freeformLayout?.length)
        ? freeformSlots(state)
        : state.freeformLayout,
    layoutMode: 'template',
    activeLayoutId: template.id,
    layoutSlots: template.slots,
    appearance: template.appearance
      ? { ...state.appearance, ...template.appearance }
      : state.appearance,
    tiles: state.tiles.map((tile) => ({ ...tile, ...positions.get(tile.id)! })),
  };
}

export function layoutOnlyState(current: WallState, preset: WallState): WallState {
  const sourceFields = new Map(current.tiles.map((tile) => [tile.id, tile]));
  const orderedCurrent = orderedTiles(current.tiles);
  const presetSlots = activeLayoutSlots(preset);
  const positions = new Map(
    orderedCurrent.map((tile, index) => {
      const position = presetSlots[index];
      return [
        tile.id,
        position && preset.layoutMode !== 'automatic'
          ? {
              x: position.column - 1,
              y: position.row - 1,
              w: position.columnSpan,
              h: position.rowSpan,
            }
          : {},
      ];
    }),
  );
  const appliedFreeform =
    preset.layoutMode === 'freeform'
      ? orderedCurrent.map((tile, index) => ({ ...presetSlots[index], id: tile.id }))
      : current.freeformLayout;
  return {
    ...current,
    layoutMode: preset.layoutMode,
    activeLayoutId:
      preset.layoutMode === 'template' ? preset.activeLayoutId : current.activeLayoutId,
    layoutSlots: preset.layoutMode === 'template' ? preset.layoutSlots : current.layoutSlots,
    freeformLayout: appliedFreeform,
    tiles: current.tiles.map((tile) => ({
      ...sourceFields.get(tile.id)!,
      ...positions.get(tile.id)!,
    })),
  };
}
