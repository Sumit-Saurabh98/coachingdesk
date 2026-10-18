import { describe, expect, it } from 'vitest';
import { InvalidMoneyError, Money } from '../index';

describe('Money', () => {
  describe('creation', () => {
    it('creates from paise and rupees', () => {
      expect(Money.ofPaise(50000).toPaise()).toBe(50000);
      expect(Money.ofRupees(500).toPaise()).toBe(50000);
    });

    it('rejects negative amounts', () => {
      expect(() => Money.ofPaise(-1)).toThrow(InvalidMoneyError);
    });

    it('rejects fractional paise and fractional rupees', () => {
      expect(() => Money.ofPaise(10.5)).toThrow(InvalidMoneyError);
      expect(() => Money.ofRupees(99.99)).toThrow(InvalidMoneyError);
    });

    it('rejects unsafe integers', () => {
      expect(() => Money.ofPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow(InvalidMoneyError);
    });
  });

  describe('arithmetic', () => {
    it('adds without changing the originals', () => {
      const a = Money.ofRupees(100);
      const b = Money.ofRupees(50);
      const sum = a.add(b);

      expect(sum.toPaise()).toBe(15000);
      expect(a.toPaise()).toBe(10000);
    });

    it('subtracts, but never goes negative', () => {
      expect(Money.ofRupees(100).subtract(Money.ofRupees(30)).toPaise()).toBe(7000);
      expect(() => Money.ofRupees(30).subtract(Money.ofRupees(100))).toThrow(InvalidMoneyError);
    });

    it('min picks the smaller amount', () => {
      expect(Money.ofRupees(30).min(Money.ofRupees(100)).equals(Money.ofRupees(30))).toBe(true);
    });
  });

  describe('comparison', () => {
    it('compares by value, not by object identity', () => {
      const a = Money.ofRupees(500);
      const b = Money.ofRupees(500);

      expect(a === b).toBe(false);
      expect(a.equals(b)).toBe(true);
    });
  });

  describe('output', () => {
    it('formats in Indian style', () => {
      expect(Money.ofRupees(123456).format()).toBe('₹1,23,456');
      expect(Money.ofPaise(123450).format()).toBe('₹1,234.50');
      expect(Money.zero().format()).toBe('₹0');
    });

    it('serialises to paise in JSON', () => {
      expect(JSON.stringify({ amountPaise: Money.ofRupees(500) })).toBe('{"amountPaise":50000}');
    });
  });
});
