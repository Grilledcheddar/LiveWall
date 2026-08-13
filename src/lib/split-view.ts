export const externalViewModes = [
  'fullscreen',
  'wall-top',
  'external-top',
  'external-left',
  'wall-left',
  'overlay',
] as const;

export type ExternalViewMode = (typeof externalViewModes)[number];
export type SplitRatio = 65 | 60 | 50;

export interface DesktopRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SplitGeometry {
  mode: ExternalViewMode;
  ratio: SplitRatio;
  wall: DesktopRect | null;
  external: DesktopRect;
  temporaryReflow: boolean;
}

const minWall = 240;

function rect(x: number, y: number, width: number, height: number): DesktopRect {
  return { x, y, width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** Calculates physical-pixel window bounds from Windows' DPI-aware working area. */
export function calculateSplitGeometry(
  workArea: DesktopRect,
  mode: ExternalViewMode,
  ratio: SplitRatio,
): SplitGeometry {
  const full = rect(workArea.x, workArea.y, workArea.width, workArea.height);
  if (mode === 'fullscreen')
    return { mode, ratio, wall: null, external: full, temporaryReflow: false };
  if (mode === 'overlay') {
    const width = Math.max(minWall, Math.round(workArea.width * (ratio / 100)));
    const height = Math.max(minWall, Math.round(workArea.height * (ratio / 100)));
    return {
      mode,
      ratio,
      wall: full,
      external: rect(
        workArea.x + (workArea.width - width) / 2,
        workArea.y + (workArea.height - height) / 2,
        width,
        height,
      ),
      temporaryReflow: false,
    };
  }
  const horizontal = mode === 'external-left' || mode === 'wall-left';
  const total = horizontal ? workArea.width : workArea.height;
  const first = Math.min(total - minWall, Math.max(minWall, Math.round(total * (ratio / 100))));
  const second = total - first;
  const firstRect = horizontal
    ? rect(workArea.x, workArea.y, first, workArea.height)
    : rect(workArea.x, workArea.y, workArea.width, first);
  const secondRect = horizontal
    ? rect(workArea.x + first, workArea.y, second, workArea.height)
    : rect(workArea.x, workArea.y + first, workArea.width, second);
  const wallFirst = mode === 'wall-top' || mode === 'wall-left';
  return {
    mode,
    ratio,
    wall: wallFirst ? firstRect : secondRect,
    external: wallFirst ? secondRect : firstRect,
    temporaryReflow: true,
  };
}
