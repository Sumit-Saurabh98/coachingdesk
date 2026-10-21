import { api } from '@/api';

/** A class test as the API returns it. */
export interface ClassTest {
  id: string;
  batchId: string;
  name: string;
  date: string; // "YYYY-MM-DD"
  maxMarks: number;
  createdBy: string | null;
  resultsSentAt: string | null; // when "Send results" was last tapped
  createdAt: string;
}

/** In a batch's list: how far marking has got. */
export interface TestSummary extends ClassTest {
  scored: number;
  absent: number;
}

export const testKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'tests'] as const,
  batch: (instituteId: string, batchId: string) =>
    [...testKeys.all(instituteId), 'batch', batchId] as const,
};

/** GET .../batches/:batchId/tests (any member): newest test date first. */
export async function listBatchTests(
  instituteId: string,
  batchId: string,
  signal?: AbortSignal,
): Promise<TestSummary[]> {
  const result = await api.get<{ tests: TestSummary[] }>(
    `/v1/institutes/${instituteId}/batches/${batchId}/tests`,
    { query: { limit: 100 }, signal },
  );
  return result.tests;
}

/** POST .../batches/:batchId/tests (owner, teacher; the plan needs result cards). */
export async function createTest(
  instituteId: string,
  batchId: string,
  body: { name: string; date: string; maxMarks: number },
): Promise<ClassTest> {
  const result = await api.post<{ test: ClassTest }>(
    `/v1/institutes/${instituteId}/batches/${batchId}/tests`,
    body,
  );
  return result.test;
}
