import { api } from '@/api';
import type { NoticeKind, SendNoticeRequest } from './notice-rules';

/** A sent notice. `content` holds what parents read (the template's parameters). */
export interface Notice {
  id: string;
  kind: NoticeKind;
  batchIds: string[];
  content: Record<string, string>;
  recipients: number; // parents it was queued for (one message per parent)
  sentBy: string | null;
  day: string; // "YYYY-MM-DD" at the institute
  createdAt: string;
}

export const noticeKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'notices'] as const,
};

/** GET .../notices (any member): newest first. */
export async function listNotices(instituteId: string, signal?: AbortSignal): Promise<Notice[]> {
  const result = await api.get<{ notices: Notice[] }>(`/v1/institutes/${instituteId}/notices`, {
    query: { limit: 50 },
    signal,
  });
  return result.notices;
}

/** POST .../notices/preview: who it would reach, before anything is sent. */
export function previewNotice(
  instituteId: string,
  body: SendNoticeRequest,
): Promise<{ recipients: number; messagesNeeded: number; quotaRemaining: number }> {
  return api.post(`/v1/institutes/${instituteId}/notices/preview`, body);
}

/** POST .../notices: queues one WhatsApp message per parent (sent by the worker). */
export function sendNotice(
  instituteId: string,
  body: SendNoticeRequest,
): Promise<{ notice: Notice; queued: number }> {
  return api.post(`/v1/institutes/${instituteId}/notices`, body);
}
