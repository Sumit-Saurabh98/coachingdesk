export class InvalidLocalDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidLocalDateError';
  }
}

const MS_PER_DAY = 86_400_000;

export class LocalDate {
  private constructor(private readonly epochDay: number) {}

  static of(year: number, month: number, day: number): LocalDate {
    if (![year, month, day].every(Number.isInteger) || year < 1900 || year > 9999) {
      throw new InvalidLocalDateError(`Invalid date: ${year}-${month}-${day}`);
    }

    const ms = Date.UTC(year, month - 1, day);

    const check = new Date(ms);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day
    ) {
      throw new InvalidLocalDateError(`Not a real calendar date: ${year}-${month}-${day}`);
    }
    return new LocalDate(ms / MS_PER_DAY);
  }

  static parse(text: string): LocalDate {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) {
      throw new InvalidLocalDateError(`Expected YYYY-MM-DD, got "${text}"`);
    }
    return LocalDate.of(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  static fromInstant(instant: Date, timeZone: string): LocalDate {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(instant);
    const part = (type: 'year' | 'month' | 'day') =>
      Number(parts.find((p) => p.type === type)?.value);
    return LocalDate.of(part('year'), part('month'), part('day'));
  }

  get year(): number {
    return this.toUtcDate().getUTCFullYear();
  }

  get month(): number {
    return this.toUtcDate().getUTCMonth() + 1;
  }

  get day(): number {
    return this.toUtcDate().getUTCDate();
  }

  isoDayOfWeek(): number {
    const jsDay = this.toUtcDate().getUTCDay();
    return jsDay === 0 ? 7 : jsDay;
  }

  addDays(days: number): LocalDate {
    if (!Number.isInteger(days)) {
      throw new InvalidLocalDateError(`Days must be a whole number, got ${days}`);
    }

    return new LocalDate(this.epochDay + days);
  }

  addMonths(months: number): LocalDate {
    if (!Number.isInteger(months)) {
      throw new InvalidLocalDateError(`Months must be a whole number, got ${months}`);
    }
    const totalMonths = this.year * 12 + (this.month - 1) + months;
    const year = Math.floor(totalMonths / 12);
    const month = (totalMonths % 12) + 1;
    const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return LocalDate.of(year, month, Math.min(this.day, lastDayOfMonth));
  }

  daysUntil(other: LocalDate): number {
    return other.epochDay - this.epochDay;
  }

  isBefore(other: LocalDate): boolean {
    return this.epochDay < other.epochDay;
  }

  isAfter(other: LocalDate): boolean {
    return this.epochDay > other.epochDay;
  }

  equals(other: LocalDate): boolean {
    return this.epochDay === other.epochDay;
  }

  toString(): string {
    const mm = String(this.month).padStart(2, '0');
    const dd = String(this.day).padStart(2, '0');
    return `${this.year}-${mm}-${dd}`;
  }

  toJSON(): string {
    return this.toString();
  }

  private toUtcDate(): Date {
    return new Date(this.epochDay * MS_PER_DAY);
  }
}
