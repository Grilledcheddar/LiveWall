import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  mergeLibraryImport,
  normalizeSourceLibrary,
  previewLibraryImport,
} from '../src/lib/library.js';
import {
  advanceQueueOnCompletion,
  emptyState,
  normalizeWallState,
  reconcileTimers,
} from '../src/lib/state.js';
import type { WallState } from '../src/lib/types.js';

export class StateStore {
  private state = emptyState();
  private readonly file: string;
  private persistQueue: Promise<void> = Promise.resolve();
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(dataDirectory: string) {
    this.file = path.join(dataDirectory, 'wall-state.json');
  }

  async load() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8')) as unknown;
      this.state = reconcileTimers(normalizeWallState(parsed));
      await this.persist();
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.error('Saved state could not be migrated. The original file was left untouched.');
        throw error;
      }
      await this.persist();
    }
  }

  get() {
    return structuredClone(this.state);
  }

  async replace(next: unknown) {
    const normalized = normalizeWallState(next);
    return this.mutate((current) =>
      reconcileTimers(
        normalizeWallState({
          ...normalized,
          version: current.version + 1,
          updatedAt: Date.now(),
          tiles: normalized.tiles.slice(0, 9),
        }),
      ),
    );
  }

  async replaceLibrary(next: unknown, expectedVersion?: number) {
    const library = normalizeSourceLibrary(next);
    return this.mutate((current) => {
      if (typeof expectedVersion === 'number' && current.version !== expectedVersion) {
        throw new Error('SOURCE_LIBRARY_CONFLICT');
      }
      return {
        ...current,
        library,
        version: current.version + 1,
        updatedAt: Date.now(),
      };
    });
  }

  previewLibraryImport(value: unknown) {
    return previewLibraryImport(this.state.library, value);
  }

  async importLibrary(value: unknown) {
    return this.enqueue(async () => {
      const preview = previewLibraryImport(this.state.library, value);
      const backupDirectory = path.join(path.dirname(this.file), 'backups');
      await mkdir(backupDirectory, { recursive: true });
      const backupPath = path.join(backupDirectory, `library-import-${Date.now()}.json`);
      await copyFile(this.file, backupPath);
      this.state = {
        ...this.state,
        library: mergeLibraryImport(this.state.library, preview),
        version: this.state.version + 1,
        updatedAt: Date.now(),
      };
      await this.persist();
      return { state: this.get(), preview, backupPath };
    });
  }

  async reconcile(now = Date.now()) {
    return this.enqueue(async () => {
      const next = reconcileTimers(this.state, now);
      if (next === this.state) return false;
      this.state = { ...next, version: this.state.version + 1 };
      await this.persist();
      return true;
    });
  }

  async saveResumePosition(tileId: string, sourceUrl: string, position: number) {
    if (!Number.isFinite(position) || position < 0) return this.get();
    return this.enqueue(async () => {
      let changed = false;
      const tiles = this.state.tiles.map((tile) => {
        if (tile.id !== tileId || tile.source.url !== sourceUrl) return tile;
        changed = true;
        return { ...tile, resumePosition: position };
      });
      if (changed) {
        this.state = {
          ...this.state,
          tiles,
          version: this.state.version + 1,
          updatedAt: Date.now(),
        };
        await this.persist();
      }
      return this.get();
    });
  }

  async advanceQueueOnCompletion(tileId: string, sourceUrl: string) {
    return this.enqueue(async () => {
      const tile = this.state.tiles.find((candidate) => candidate.id === tileId);
      if (!tile || tile.source.url !== sourceUrl) return undefined;
      const next = advanceQueueOnCompletion(this.state, tileId);
      if (next === this.state) return undefined;
      this.state = normalizeWallState({
        ...next,
        version: this.state.version + 1,
        updatedAt: Date.now(),
      });
      await this.persist();
      return this.get();
    });
  }

  private mutate(change: (current: WallState) => WallState) {
    return this.enqueue(async () => {
      this.state = normalizeWallState(change(this.state));
      await this.persist();
      return this.get();
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const queued = this.mutationQueue.then(operation, operation);
    this.mutationQueue = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  }

  private async persist() {
    const payload = JSON.stringify(this.state, null, 2);
    const temp = `${this.file}.tmp`;
    const operation = this.persistQueue.then(async () => {
      await writeFile(temp, payload, 'utf8');
      await rename(temp, this.file);
    });
    this.persistQueue = operation.catch(() => undefined);
    await operation;
  }
}
