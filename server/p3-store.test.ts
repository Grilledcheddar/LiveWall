import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AtomicJsonStore } from './p3-store';

describe('P3 atomic JSON store', () => {
  it('serializes concurrent updates and leaves valid durable JSON', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'livewall-p3-store-'));
    const store = new AtomicJsonStore(
      directory,
      'progress.json',
      () => ({ count: 0 }),
      (value) => {
        const count = Number((value as { count?: number })?.count);
        return { count: Number.isFinite(count) ? count : 0 };
      },
    );
    await store.load();
    await Promise.all(
      Array.from({ length: 20 }, () => store.update((current) => ({ count: current.count + 1 }))),
    );
    expect(store.get().count).toBe(20);
    expect(JSON.parse(await readFile(path.join(directory, 'progress.json'), 'utf8'))).toEqual({
      count: 20,
    });
  });
});
