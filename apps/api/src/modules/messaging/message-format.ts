import type { Money } from '@coachingdesk/shared';

// Shared by the message renderers (fee reminders, receipts): one wording everywhere.

/** "1,500" / "1,500.50": the template already has the ₹ sign. */
export function rupees(amount: Money): string {
  return amount.format().replace(/^₹/, '');
}

/** "Aarav", "Aarav and Bhavya", "Aarav, Bhavya and Chirag". */
export function joinNames(names: string[]): string {
  return names.length <= 2
    ? names.join(' and ')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}
