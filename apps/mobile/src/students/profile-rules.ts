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
 * Batches the student can join: active ones they're not staying in. Only an enrollment with NO
 * end date blocks a batch: one that ends today or later (just removed, or leaving soon) can be
 * added back, and the API reopens it instead of creating a second one.
 */
export function joinableBatches<B extends { id: string; archivedAt: string | null }>(
  batches: readonly B[],
  enrollments: readonly Enrollment[],
): B[] {
  const staying = new Set(enrollments.filter((e) => e.endDate === null).map((e) => e.batchId));
  return batches.filter((batch) => batch.archivedAt === null && !staying.has(batch.id));
}

/** "tel:+919876543210": opens the phone's dialer with the number filled in. */
export function telLink(e164: string): string {
  return `tel:${e164}`;
}

/** "https://wa.me/919876543210": opens a WhatsApp chat with this number (no "+"). */
export function whatsAppLink(e164: string): string {
  return `https://wa.me/${e164.replace(/^\+/, '')}`;
}
