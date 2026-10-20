import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * Where generated files (data exports) live. Production: S3 in ap-south-1 (data stays in India,
 * NFR-9) once the infra exists. Files are never public: the API reads them and streams them to
 * the logged-in owner.
 */
export interface FileStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** null when there is no such file. */
  get(key: string): Promise<Uint8Array | null>;
  /** Deleting a missing file is fine (the purge and expiry jobs may run twice). */
  delete(key: string): Promise<void>;
}

// Keys are ours ("exports/<uuid>/<uuid>.zip"), but checking costs nothing and rules out
// "../../etc/passwd" for good: only plain path segments.
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error(`FileStore: unsafe key ${JSON.stringify(key)}`);
  }
}

/** Tests only. */
export class InMemoryFileStore implements FileStore {
  readonly files = new Map<string, { data: Uint8Array; contentType: string }>();

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    this.files.set(key, { data: Uint8Array.from(data), contentType });
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertSafeKey(key);
    const file = this.files.get(key);
    return file ? Uint8Array.from(file.data) : null;
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    this.files.delete(key);
  }
}

/**
 * Local development: files in a folder on this machine (API and worker share it). Refused in
 * production by both composition roots, like the console SMS/WhatsApp providers.
 */
export class LocalFileStore implements FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, data: Uint8Array, _contentType: string): Promise<void> {
    const path = this.pathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathOf(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }

  private pathOf(key: string): string {
    assertSafeKey(key);
    const path = join(this.root, ...key.split('/'));
    if (!path.startsWith(this.root + sep)) {
      throw new Error('FileStore: key escapes the root folder');
    }
    return path;
  }
}
