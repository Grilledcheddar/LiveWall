import { canonicalSourceUrl } from './sources.js';
import type {
  PlaybackProgress,
  PlaybackProgressFile,
  PlaybackStart,
  StartBehavior,
  VideoSource,
} from './types.js';

export const PROGRESS_VERSION = 1 as const;
export const PROGRESS_INTERVAL_MS = 12_000;
export const RESUME_END_THRESHOLD_SECONDS = 15;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Math.floor(Number(text));
  const parts = text.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part)))
    return undefined;
  const values = parts.map(Number);
  if (values.slice(1).some((part) => part > 59)) return undefined;
  return parts.length === 2
    ? values[0] * 60 + values[1]
    : values[0] * 3600 + values[1] * 60 + values[2];
}

export function formatTimestamp(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function defaultStartBehavior(source: VideoSource): PlaybackStart {
  if (source.type === 'website') return { behavior: 'beginning' };
  if (source.type === 'hls' && /(?:live|stream|channel)/i.test(source.url))
    return { behavior: 'live' };
  if (source.type === 'youtube' && /\/live\//i.test(source.url)) return { behavior: 'live' };
  return { behavior: 'resume' };
}

export function normalizePlaybackStart(value: unknown, source: VideoSource): PlaybackStart {
  const candidate = isRecord(value) ? value : {};
  const behavior: StartBehavior = ['live', 'resume', 'specific', 'beginning'].includes(
    String(candidate.behavior),
  )
    ? (candidate.behavior as StartBehavior)
    : defaultStartBehavior(source).behavior;
  const specificTime = parseTimestamp(candidate.specificTime);
  return behavior === 'specific' && specificTime !== undefined
    ? { behavior, specificTime }
    : behavior === 'specific'
      ? { behavior: 'beginning' }
      : { behavior };
}

export function playbackKey(source: VideoSource) {
  return canonicalSourceUrl(source);
}

export function resumeTarget(
  progress: Pick<PlaybackProgress, 'position' | 'duration'> | undefined,
) {
  if (!progress || !Number.isFinite(progress.position) || progress.position < 0) return 0;
  if (
    typeof progress.duration === 'number' &&
    Number.isFinite(progress.duration) &&
    progress.duration - progress.position <= RESUME_END_THRESHOLD_SECONDS
  )
    return 0;
  return progress.position;
}

export function normalizePlaybackProgress(value: unknown): PlaybackProgressFile {
  const root = isRecord(value) ? value : {};
  const seen = new Set<string>();
  const entries = (Array.isArray(root.entries) ? root.entries : [])
    .flatMap((candidate): PlaybackProgress[] => {
      if (!isRecord(candidate) || typeof candidate.key !== 'string' || seen.has(candidate.key))
        return [];
      const position = Number(candidate.position);
      if (!Number.isFinite(position) || position < 0) return [];
      seen.add(candidate.key);
      const duration = Number(candidate.duration);
      const playlistIndex = Number(candidate.playlistIndex);
      return [
        {
          key: candidate.key,
          position,
          duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
          playlistIndex:
            Number.isInteger(playlistIndex) && playlistIndex >= 0 ? playlistIndex : undefined,
          updatedAt:
            typeof candidate.updatedAt === 'number' && Number.isFinite(candidate.updatedAt)
              ? candidate.updatedAt
              : Date.now(),
        },
      ];
    })
    .slice(0, 500);
  return { format: 'livewall-playback-progress', version: PROGRESS_VERSION, entries };
}
