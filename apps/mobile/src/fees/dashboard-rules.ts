// Pure TypeScript: the fee dashboard's rules, unit-tested in Node.
import type { PaymentMethod } from './fees-api';

const METHOD_ORDER: readonly PaymentMethod[] = ['upi', 'cash', 'bank', 'other'];

/** How this month's money came in: only the methods used, in a fixed order (UPI first). */
export function methodParts(
  byMethod: Partial<Record<PaymentMethod, number>>,
): Array<{ method: PaymentMethod; paise: number }> {
  return METHOD_ORDER.flatMap((method) => {
    const paise = byMethod[method] ?? 0;
    return paise > 0 ? [{ method, paise }] : [];
  });
}
