export type SourceType = 'youtube' | 'youtube-playlist' | 'hls' | 'website' | 'mock';
export type StartBehavior = 'live' | 'resume' | 'specific' | 'beginning';

export interface PlaybackStart {
  behavior: StartBehavior;
  specificTime?: number;
}

export interface VideoSource {
  url: string;
  type: SourceType;
  youtubeId?: string;
  playlistId?: string;
}

export interface Tile {
  id: string;
  name: string;
  titleMode?: 'auto' | 'manual';
  source: VideoSource;
  queuedSource?: VideoSource;
  queuedPlayback?: PlaybackStart;
  scheduledAt?: number;
  x: number;
  y: number;
  w: number;
  h: number;
  muted: boolean;
  volume: number;
  displayOrder: number;
  resumePosition?: number;
  playback?: PlaybackStart;
  playlistIndex?: number;
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
  saved: boolean;
  favorite: boolean;
  recent: boolean;
  folderId?: string;
  hostname?: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  useCount: number;
  playback?: PlaybackStart;
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
  isLive?: boolean;
  atLiveEdge?: boolean;
  position?: number;
  duration?: number;
  playlistIndex?: number;
  playlistLength?: number;
  currentTitle?: string;
  upNextTitle?: string;
  warning?: string;
}

export interface LayoutSlot {
  id: string;
  column: number;
  row: number;
  columnSpan: number;
  rowSpan: number;
}

export interface LayoutTemplate {
  id: string;
  name: string;
  builtIn: boolean;
  columns: number;
  rows: number;
  slots: LayoutSlot[];
  appearance?: Partial<WallAppearance>;
  createdAt: number;
  updatedAt: number;
}

export interface LayoutTemplateFile {
  format: 'livewall-layout-templates';
  version: 1;
  templates: LayoutTemplate[];
}

export interface PlaybackProgress {
  key: string;
  position: number;
  duration?: number;
  playlistIndex?: number;
  updatedAt: number;
}

export interface PlaybackProgressFile {
  format: 'livewall-playback-progress';
  version: 1;
  entries: PlaybackProgress[];
}

export interface WallPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  state: WallState;
}

export interface WallPresetFile {
  format: 'livewall-wall-presets';
  version: 1;
  presets: WallPreset[];
}

export interface WallState {
  schemaVersion: 3;
  version: number;
  updatedAt: number;
  layoutMode: 'automatic' | 'freeform' | 'template';
  activeLayoutId?: string;
  layoutSlots?: LayoutSlot[];
  tiles: Tile[];
  activeAudioTileId?: string;
  globallyStopped: boolean;
  focusedTileId?: string;
  overlayMode: OverlayMode;
  appearance: WallAppearance;
  library: SourceLibrary;
}

export type PlayerCommandName =
  | 'play'
  | 'pause'
  | 'seek'
  | 'mute'
  | 'unmute'
  | 'volume'
  | 'stop'
  | 'resume'
  | 'retry'
  | 'go-live'
  | 'restart'
  | 'previous'
  | 'next';

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
