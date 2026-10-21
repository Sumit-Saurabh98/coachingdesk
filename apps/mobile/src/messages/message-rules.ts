// Pure TypeScript: the message log's rules, unit-tested in Node.

export type MessageStatus =
  'queued' | 'scheduled' | 'sending' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export type MessageCategory = 'fee_reminder' | 'receipt' | 'absence' | 'result' | 'notice';

export type SkipReason =
  | 'opted_out'
  | 'no_consent'
  | 'over_quota'
  | 'plan_disallows'
  | 'nothing_due'
  | 'stale'
  | 'expired'
  | 'institute_paused'
  | 'platform_limit';

/** What the owner cares about: still waiting, on its way, arrived, read, or why not. */
export type StatusTone = 'waiting' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped';

export function statusTone(status: MessageStatus): StatusTone {
  return status === 'queued' || status === 'scheduled' || status === 'sending' ? 'waiting' : status;
}

export interface Usage {
  month: string;
  used: number;
  limit: number; // the plan's monthly quota (0 on Free)
  todayUsed: number;
  todayLimit: number | null; // only during the trial and an institute's first 7 days
  trialTotalLimit: number | null; // 200 during the trial
}

/** 0..1 of the monthly quota used (1 when the plan has none: nothing can go out). */
export function usageShare(usage: Pick<Usage, 'used' | 'limit'>): number {
  return usage.limit <= 0 ? 1 : Math.min(1, usage.used / usage.limit);
}

/** Worth a warning: 80% or more of the month's messages used (or none allowed). */
export function nearLimit(usage: Pick<Usage, 'used' | 'limit'>): boolean {
  return usageShare(usage) >= 0.8;
}
