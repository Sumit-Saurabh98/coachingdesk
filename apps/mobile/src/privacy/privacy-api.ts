import { File, Paths } from 'expo-file-system';
import { api, session } from '@/api';
import { type DataExport, exportFileName } from './data-rules';

export const exportKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'exports'] as const,
};

/** GET .../exports (owner): newest first. */
export async function listExports(
  instituteId: string,
  signal?: AbortSignal,
): Promise<DataExport[]> {
  const result = await api.get<{ exports: DataExport[] }>(`/v1/institutes/${instituteId}/exports`, {
    query: { limit: 10 },
    signal,
  });
  return result.exports;
}

/** POST .../exports (owner): queues a full export (or returns the one already being made). */
export async function requestExport(instituteId: string): Promise<DataExport> {
  const result = await api.post<{ export: DataExport }>(`/v1/institutes/${instituteId}/exports`);
  return result.export;
}

/**
 * Downloads a ready export to this phone's cache. The download needs the owner's login (the
 * file holds every phone number): never a public link. Any API call first, so an expired
 * access token is renewed before the download uses it.
 */
export async function downloadExport(item: DataExport): Promise<File> {
  if (!item.downloadPath) {
    throw new Error('This export is not ready');
  }
  await api.get('/v1/me'); // renews the access token if needed
  const token = session.accessToken;
  return File.downloadFileAsync(
    `${api.baseUrl}${item.downloadPath}`,
    new File(Paths.cache, exportFileName(item.createdAt)),
    { headers: token ? { Authorization: `Bearer ${token}` } : {}, idempotent: true },
  );
}
