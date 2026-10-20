import { type FileStore, LocalFileStore } from '@coachingdesk/providers';
import { z } from 'zod';

// Shared by config.ts (API: downloads) and worker-config.ts (worker: builds and deletes).
export const FileStoreConfig = {
  // local = a folder on this machine (dev only; refused in production). s3 = with the infra.
  FILE_STORE: z.enum(['local', 's3']).default('local'),
  // Relative to where the process starts (apps/api for both API and worker).
  FILE_STORE_DIR: z.string().default('.data/files'),
};

export function createFileStore(config: {
  NODE_ENV: string;
  FILE_STORE: 'local' | 's3';
  FILE_STORE_DIR: string;
}): FileStore {
  switch (config.FILE_STORE) {
    case 'local':
      if (config.NODE_ENV === 'production') {
        throw new Error('Refusing to start: FILE_STORE=local is not allowed in production');
      }
      return new LocalFileStore(config.FILE_STORE_DIR);
    case 's3':
      throw new Error('S3FileStore is not implemented yet');
  }
}
