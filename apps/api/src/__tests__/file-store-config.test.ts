import { LocalFileStore } from '@coachingdesk/providers';
import { describe, expect, it } from 'vitest';
import { createFileStore } from '../file-store-config';

describe('createFileStore', () => {
  it('local in development', () => {
    expect(
      createFileStore({ NODE_ENV: 'development', FILE_STORE: 'local', FILE_STORE_DIR: '.data/x' }),
    ).toBeInstanceOf(LocalFileStore);
  });

  it('production refuses a folder on one machine (exports would hold every phone number)', () => {
    expect(() =>
      createFileStore({ NODE_ENV: 'production', FILE_STORE: 'local', FILE_STORE_DIR: '.data/x' }),
    ).toThrow('FILE_STORE=local is not allowed in production');
  });

  it('s3 says clearly that it is not built yet', () => {
    expect(() =>
      createFileStore({ NODE_ENV: 'development', FILE_STORE: 's3', FILE_STORE_DIR: '' }),
    ).toThrow('not implemented');
  });
});
