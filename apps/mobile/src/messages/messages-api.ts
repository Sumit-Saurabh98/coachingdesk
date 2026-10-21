import { api } from '@/api';
import type { MessageCategory, MessageStatus, SkipReason, Usage } from './message-rules';

/** One WhatsApp message in the outbox (owner, staff). `to` is masked by the server. */
export interface OutboxMessage {
  id: string;
  category: MessageCategory;
  template: string;
  to: string;
  status: MessageStatus;
  skipReason: SkipReason | null;
  errorCode: string | null;
  attempts: number;
  scheduledFor: string;
  createdAt: string;
}

export interface MessagePage {
  messages: OutboxMessage[];
  nextCursor: string | null;
}

export const messageKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'messages'] as const,
  list: (instituteId: string, category: MessageCategory | null) =>
    [...messageKeys.all(instituteId), 'list', category ?? 'all'] as const,
  usage: (instituteId: string) => [...messageKeys.all(instituteId), 'usage'] as const,
};

/** GET .../messages?category&limit&cursor: newest first. */
export function listMessages(
  instituteId: string,
  options: { category: MessageCategory | null; cursor?: string; signal?: AbortSignal },
): Promise<MessagePage> {
  return api.get(`/v1/institutes/${instituteId}/messages`, {
    query: { category: options.category ?? undefined, limit: 50, cursor: options.cursor },
    signal: options.signal,
  });
}

/** GET .../messages/usage: this month's messages against the plan's limits. */
export function getUsage(instituteId: string, signal?: AbortSignal): Promise<Usage> {
  return api.get(`/v1/institutes/${instituteId}/messages/usage`, { signal });
}
