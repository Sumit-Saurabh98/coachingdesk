import { api } from '@/api';

export type PaymentMethod = 'upi_link' | 'cash' | 'bank' | 'other';

/** GET .../fees/dashboard (owner, staff). Money in paise (integers), like everywhere. */
export interface FeeDashboard {
  month: string; // "YYYY-MM": only collectedPaise and byMethod are for this month
  collectedPaise: number;
  byMethod: Partial<Record<PaymentMethod, number>>;
  pendingPaise: number; // as of now, all open fees
  overdueCount: number; // open invoices past their due date
  topOverdue: Array<{
    studentId: string;
    name: string;
    guardianPhone: string; // masked by the server
    overduePaise: number;
    daysOverdue: number; // since the OLDEST overdue due date
  }>;
}

/** Cache keys, under the institute (like batches, students and attendance). */
export const feeKeys = {
  all: (instituteId: string) => ['institutes', instituteId, 'fees'] as const,
  dashboard: (instituteId: string, month: string | null) =>
    [...feeKeys.all(instituteId), 'dashboard', month ?? 'current'] as const,
};

/** `month` null = this month at the institute (the server decides). */
export function getFeeDashboard(
  instituteId: string,
  month: string | null,
  signal?: AbortSignal,
): Promise<FeeDashboard> {
  return api.get(`/v1/institutes/${instituteId}/fees/dashboard`, {
    query: { month: month ?? undefined },
    signal,
  });
}
