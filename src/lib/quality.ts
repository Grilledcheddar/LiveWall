import type { HlsQualityLevel, QualityPreference } from './types.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const AUTO_QUALITY: Readonly<QualityPreference> = Object.freeze({ mode: 'auto' });

export function normalizeQualityPreference(value: unknown): QualityPreference {
  if (!isRecord(value) || value.mode !== 'level') return { mode: 'auto' };
  const height = Number(value.height);
  const bitrate = Number(value.bitrate);
  if ((!Number.isFinite(height) || height <= 0) && (!Number.isFinite(bitrate) || bitrate <= 0))
    return { mode: 'auto' };
  return {
    mode: 'level',
    height: Number.isFinite(height) && height > 0 ? Math.round(height) : undefined,
    bitrate: Number.isFinite(bitrate) && bitrate > 0 ? Math.round(bitrate) : undefined,
  };
}

export function normalizeQualityPreferences(value: unknown) {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.length > 0)
      .map(([key, preference]) => [key, normalizeQualityPreference(preference)]),
  );
}

export function resolveHlsQualityLevel(
  levels: HlsQualityLevel[],
  preference: QualityPreference | undefined,
) {
  const normalized = normalizeQualityPreference(preference);
  if (normalized.mode === 'auto') return { index: -1, fallback: false };
  const match = levels.find(
    (level) =>
      (normalized.height === undefined || level.height === normalized.height) &&
      (normalized.bitrate === undefined || level.bitrate === normalized.bitrate),
  );
  return match ? { index: match.index, fallback: false } : { index: -1, fallback: true };
}

export function hlsQualityLabel(level: Pick<HlsQualityLevel, 'height' | 'bitrate'>) {
  const resolution = level.height ? `${level.height}p` : undefined;
  const bitrate = level.bitrate ? `${(level.bitrate / 1_000_000).toFixed(1)} Mbps` : undefined;
  return [resolution, bitrate].filter(Boolean).join(' · ') || 'Unknown level';
}

export function qualityPreferenceValue(preference: QualityPreference | undefined) {
  const normalized = normalizeQualityPreference(preference);
  return normalized.mode === 'auto'
    ? 'auto'
    : `level:${normalized.height ?? ''}:${normalized.bitrate ?? ''}`;
}

export function qualityPreferenceForLevel(level: HlsQualityLevel): QualityPreference {
  return { mode: 'level', height: level.height, bitrate: level.bitrate };
}
