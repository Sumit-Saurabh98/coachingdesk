// Pure TypeScript: the "record payment" form's rules, unit-tested in Node. Money is handled as
// integer paise from the moment it's typed: "1,500.50" -> 150050, never 1500.5 (no floats).

/** What the owner typed -> paise, or null if it isn't an amount (₹, commas and spaces allowed). */
export function parseRupees(text: string): number | null {
  const cleaned = text.replace(/[₹,\s]/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) {
    return null;
  }
  const paise = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return paise > 0 && Number.isSafeInteger(paise) ? paise : null;
}

/** 150000 -> "1500"; 150050 -> "1500.50" (the form's starting text). */
export function paiseToInput(paise: number): string {
  const rupees = Math.trunc(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`;
}

/** Paid more than is left: the extra is kept as the family's credit (API_DOCS §8). */
export function extraAsCredit(amountPaise: number, remainingPaise: number): number {
  return Math.max(0, amountPaise - remainingPaise);
}

/**
 * When it was paid, for the API (ISO with a zone). Today: right now. An earlier day: noon on
 * that day on this phone (the time isn't asked for; noon can't slip to another date).
 */
export function paidAtFor(day: string, today: string, now: Date): string {
  if (day === today) {
    return now.toISOString();
  }
  const [year = 1970, month = 1, date = 1] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12, 0, 0).toISOString();
}
