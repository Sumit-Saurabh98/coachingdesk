import type {
  BatchSchedule,
  CreateBatchBody,
  FeeCycle,
  UpdateBatchBody,
} from '@coachingdesk/shared';
import { api } from '@/api';

/**
 * A batch as the API returns it (Batch.toPublicJSON). `defaultFeePaise` is MISSING for
 * teachers: the server removes money fields for them (KB #31), so the app never has to hide
 * anything itself. Show a fee only when the field is there.
 */
export interface Batch {
  id: string;
  name: string;
  subject: string | null;
  schedule: BatchSchedule;
  defaultFeePaise?: number;
  defaultFeeCycle: FeeCycle;
  archivedAt: string | null;
}

/**
 * Cache keys, always starting with the institute: switching institutes can never show the
 * other institute's batches, and invalidating ['institutes', id, 'batches'] refreshes every
 * batch query of that institute at once (list, archived list, details).
 */
export const batchKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'batches'] as const,
  list: (instituteId: string, includeArchived: boolean) =>
    [...batchKeys.all(instituteId), 'list', { includeArchived }] as const,
  detail: (instituteId: string, batchId: string) =>
    [...batchKeys.all(instituteId), 'detail', batchId] as const,
};

const base = (instituteId: string) => `/v1/institutes/${instituteId}/batches`;

/** GET .../batches?includeArchived -> oldest first. */
export async function listBatches(
  instituteId: string,
  includeArchived: boolean,
  signal?: AbortSignal,
): Promise<Batch[]> {
  const result = await api.get<{ batches: Batch[] }>(base(instituteId), {
    query: { includeArchived },
    signal,
  });
  return result.batches;
}

/** GET .../batches/:id -> the batch and how many students are enrolled today. */
export function getBatch(
  instituteId: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<{ batch: Batch; enrolledCount: number }> {
  return api.get(`${base(instituteId)}/${batchId}`, { signal });
}

/** POST .../batches (owner, staff). */
export async function createBatch(instituteId: string, body: CreateBatchBody): Promise<Batch> {
  return (await api.post<{ batch: Batch }>(base(instituteId), body)).batch;
}

/** PATCH .../batches/:id (owner, staff): only the fields that change. */
export async function updateBatch(
  instituteId: string,
  batchId: string,
  body: UpdateBatchBody,
): Promise<Batch> {
  return (await api.patch<{ batch: Batch }>(`${base(instituteId)}/${batchId}`, body)).batch;
}

/** POST .../batches/:id/archive (owner, staff). Safe to repeat. */
export async function archiveBatch(instituteId: string, batchId: string): Promise<Batch> {
  return (await api.post<{ batch: Batch }>(`${base(instituteId)}/${batchId}/archive`)).batch;
}
