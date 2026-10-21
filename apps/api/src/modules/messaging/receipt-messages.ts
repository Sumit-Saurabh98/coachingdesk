/** The dedupe key of a payment receipt: one per payment, ever (LLD §6.4). */
/** The guardian's receipt; with studentId, the copy to that student's own number (KB #50). */
export function receiptDedupeKey(paymentId: string, studentId?: string): string {
  return studentId ? `receipt:${paymentId}:student:${studentId}` : `receipt:${paymentId}`;
}

export function parseReceiptDedupeKey(key: string): { paymentId: string } | null {
  const [kind, paymentId, ...rest] = key.split(':');
  const copyOk = rest.length === 0 || (rest.length === 2 && rest[0] === 'student' && rest[1]);
  return kind === 'receipt' && paymentId && copyOk ? { paymentId } : null;
}
