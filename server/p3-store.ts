import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class AtomicJsonStore<T> {
  private value: T;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;

  constructor(
    dataDirectory: string,
    fileName: string,
    initial: () => T,
    private readonly normalize: (value: unknown) => T,
  ) {
    this.file = path.join(dataDirectory, fileName);
    this.value = initial();
  }

  async load() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.value = this.normalize(JSON.parse(await readFile(this.file, 'utf8')));
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.error(
          `${path.basename(this.file)} could not be migrated; the original was preserved.`,
        );
        throw error;
      }
    }
    await this.persist();
  }

  get() {
    return structuredClone(this.value);
  }

  replace(value: unknown) {
    return this.update(() => this.normalize(value));
  }

  update(change: (current: T) => T) {
    return this.enqueue(async () => {
      this.value = this.normalize(change(this.value));
      await this.persist();
      return this.get();
    });
  }

  async backup(prefix: string) {
    const directory = path.join(path.dirname(this.file), 'backups');
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${prefix}-${Date.now()}.json`);
    await copyFile(this.file, target);
    return target;
  }

  private enqueue<R>(operation: () => Promise<R>): Promise<R> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async persist() {
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(this.value, null, 2), 'utf8');
    await rename(temp, this.file);
  }
}
