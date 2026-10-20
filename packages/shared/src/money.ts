export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  private constructor(private readonly paise: number) {}

  static ofPaise(paise: number): Money {
    if (!Number.isSafeInteger(paise)) {
      throw new InvalidMoneyError(`Paise must be a whole number, got ${paise}`);
    }
    if (paise < 0) {
      throw new InvalidMoneyError(`Money cannot be negative, got ${paise}`);
    }
    return new Money(paise);
  }

  /** Whole rupees only — fractional rupees would bring floats back in. */
  static ofRupees(rupees: number): Money {
    if (!Number.isSafeInteger(rupees)) {
      throw new InvalidMoneyError(`Rupees must be a whole number, got ${rupees}`);
    }
    return Money.ofPaise(rupees * 100);
  }

  static zero(): Money {
    return new Money(0);
  }

  toPaise(): number {
    return this.paise;
  }

  add(other: Money): Money {
    return Money.ofPaise(this.paise + other.paise);
  }

  subtract(other: Money): Money {
    return Money.ofPaise(this.paise - other.paise);
  }

  min(other: Money): Money {
    return this.paise <= other.paise ? this : other;
  }

  isZero(): boolean {
    return this.paise === 0;
  }

  isGreaterThan(other: Money): boolean {
    return this.paise > other.paise;
  }

  equals(other: Money): boolean {
    return this.paise === other.paise;
  }

  format(): string {
    const hasPaise = this.paise % 100 !== 0;
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: hasPaise ? 2 : 0,
      maximumFractionDigits: 2,
    }).format(this.paise / 100);
  }

  /** "1500.00": plain, for CSV exports (no ₹, no grouping, always 2 decimals). */
  toDecimalString(): string {
    return `${Math.trunc(this.paise / 100)}.${String(this.paise % 100).padStart(2, '0')}`;
  }

  toJSON(): number {
    return this.paise;
  }
}
