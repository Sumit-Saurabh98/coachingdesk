/** The dedupe key of a payment receipt: one per payment, ever (LLD §6.4). */
export function receiptDedupeKey(paymentId: string): string {
  return `receipt:${paymentId}`;
}

export function parseReceiptDedupeKey(key: string): { paymentId: string } | null {
  const [kind, paymentId, ...rest] = key.split(':');
  return kind === 'receipt' && paymentId && rest.length === 0 ? { paymentId } : null;
}
