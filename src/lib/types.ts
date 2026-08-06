export type SourceType = 'youtube' | 'hls' | 'website' | 'mock';

export interface VideoSource {
  url: string;
  type: SourceType;
  youtubeId?: string;
}

export interface Tile {
  id: string;
  name: string;
  titleMode?: 'auto' | 'manual';
  source: VideoSource;
  queuedSource?: VideoSource;
  scheduledAt?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  muted: boolean;
  volume: number;
  displayOrder: number;
  resumePosition?: number;
}

export type OverlayMode = 'off' | 'hover' | 'always';
export type PlayerHealthStatus =
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'retrying'
  | 'stopped'
  | 'unsupported'
  | 'failed'
  | 'unknown';

export interface WallAppearance {
  backgroundColor: string;
  gap: number;
  borderVisible: boolean;
  borderColor: string;
  borderWidth: number;
  cornerRadius: number;
}

export interface LibrarySource {
  id: string;
  originalUrl: string;
  canonicalUrl: string;
  source: VideoSource;
  title: string;
  titleMode: 'auto' | 'manual';
  favorite: boolean;
  recent: boolean;
  folderId?: string;
  hostname?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  useCount: number;
}

export interface SourceFolder {
  id: string;
  name: string;
  displayOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface SourceLibrary {
  version: 1;
  entries: LibrarySource[];
  folders: SourceFolder[];
}

export interface LibraryImportFile {
  format: 'livewall-source-library';
  version: 1;
  exportedAt: number;
  library: SourceLibrary;
}

export interface PlayerHealth {
  tileId: string;
  sourceUrl: string;
  status: PlayerHealthStatus;
  changedAt: number;
  lastReadyAt?: number;
  message?: string;
  technicalDetail?: string;
  retryAttempt?: number;
  nextRetryAt?: number;
}

export interface WallState {
  version: number;
  updatedAt: number;
  layoutMode: 'automatic' | 'freeform';
  tiles: Tile[];
  activeAudioTileId?: string;
  globallyStopped: boolean;
  focusedTileId?: string;
  overlayMode: OverlayMode;
  appearance: WallAppearance;
  library: SourceLibrary;
}

export type PlayerCommandName =
  'play' | 'pause' | 'seek' | 'mute' | 'unmute' | 'volume' | 'stop' | 'resume' | 'retry';

export interface PlayerCommand {
  id: string;
  tileId: string;
  command: PlayerCommandName;
  value?: number;
  sentAt: number;
}

export type ServerMessage =
  | { type: 'state'; state: WallState }
  | { type: 'command'; command: PlayerCommand }
  | { type: 'health'; health: PlayerHealth }
  | { type: 'error'; message: string }
  | { type: 'hello'; state: WallState };
