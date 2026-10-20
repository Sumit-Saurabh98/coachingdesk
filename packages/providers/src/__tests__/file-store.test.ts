import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type FileStore, InMemoryFileStore, LocalFileStore } from '../index';

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (data: Uint8Array | null) => (data ? new TextDecoder().decode(data) : null);

/** One contract, both implementations: the fake must behave like the real thing. */
function describeFileStoreContract(name: string, create: () => Promise<FileStore>): void {
  describe(`FileStore contract: ${name}`, () => {
    it('put, get, overwrite, delete; a missing file is null', async () => {
      const store = await create();
      await store.put('exports/i1/e1.zip', bytes('first'), 'application/zip');
      expect(text(await store.get('exports/i1/e1.zip'))).toBe('first');

      await store.put('exports/i1/e1.zip', bytes('second'), 'application/zip');
      expect(text(await store.get('exports/i1/e1.zip'))).toBe('second');

      await store.delete('exports/i1/e1.zip');
      expect(await store.get('exports/i1/e1.zip')).toBeNull();
      await store.delete('exports/i1/e1.zip'); // twice is fine
      expect(await store.get('never/was.zip')).toBeNull();
    });

    it.each(['../escape.zip', 'exports/../../etc/passwd', '/abs.zip', 'a//b', 'a/./b', ''])(
      'refuses the unsafe key %j',
      async (key) => {
        const store = await create();
        await expect(store.put(key, bytes('x'), 'text/plain')).rejects.toThrow('unsafe key');
        await expect(store.get(key)).rejects.toThrow('unsafe key');
      },
    );
  });
}

const dirs: string[] = [];
afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describeFileStoreContract('InMemoryFileStore', async () => new InMemoryFileStore());
describeFileStoreContract('LocalFileStore', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'file-store-'));
  dirs.push(dir);
  return new LocalFileStore(dir);
});

describe('LocalFileStore', () => {
  it('writes inside its root folder only', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'file-store-'));
    dirs.push(dir);
    await new LocalFileStore(dir).put('exports/x/y.zip', bytes('z'), 'application/zip');
    expect(await readdir(join(dir, 'exports', 'x'))).toEqual(['y.zip']);
  });
});
