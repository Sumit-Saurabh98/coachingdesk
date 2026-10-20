// Pure TypeScript: the student profile's rules, unit-tested in Node.
import type { FeeCycle } from '@coachingdesk/shared';

/** An enrollment as the API returns it. Fee fields are MISSING for teachers (KB #31). */
export interface Enrollment {
  id: string;
  studentId: string;
  batchId: string;
  feePaise?: number;
  discountPaise?: number;
  netFeePaise?: number;
  feeCycle?: FeeCycle;
  startDate: string; // "YYYY-MM-DD"
  endDate: string | null; // last day attending; null = still in the batch
}

/** Still in the batch on `today` ("YYYY-MM-DD"): no end date, or the end date isn't past. */
export function isOpenOn(enrollment: Enrollment, today: string): boolean {
  // ISO dates compare correctly as text.
  return enrollment.endDate === null || enrollment.endDate >= today;
}

/**
 * Batches the student can still join: active ones they're not in right now. (The API allows
 * one OPEN enrollment per student and batch; rejoining after leaving is fine.)
 */
export function joinableBatches<B extends { id: string; archivedAt: string | null }>(
  batches: readonly B[],
  enrollments: readonly Enrollment[],
  today: string,
): B[] {
  const inNow = new Set(enrollments.filter((e) => isOpenOn(e, today)).map((e) => e.batchId));
  return batches.filter((batch) => batch.archivedAt === null && !inNow.has(batch.id));
}

/** "tel:+919876543210": opens the phone's dialer with the number filled in. */
export function telLink(e164: string): string {
  return `tel:${e164}`;
}

/** "https://wa.me/919876543210": opens a WhatsApp chat with this number (no "+"). */
export function whatsAppLink(e164: string): string {
  return `https://wa.me/${e164.replace(/^\+/, '')}`;
}
