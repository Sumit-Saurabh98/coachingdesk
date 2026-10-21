import { Money } from '@coachingdesk/shared';

/** 150000 paise -> "₹1,500" (Indian grouping; paise shown only when there are any). */
export function rupees(paise: number): string {
  return Money.ofPaise(paise).format();
}
