import { describe, expect, it } from 'vitest';
import { discountedUnitPrice, orderTotal } from './pricing';
import { ValidationError } from './errors';

describe('catalog pricing', () => {
  it('rounds discounted unit prices to cents, including half-cent boundaries', () => {
    expect(discountedUnitPrice(129.99, 0.25)).toBe(97.49);
    expect(discountedUnitPrice(89.99)).toBe(89.99);
    expect(discountedUnitPrice(1.005, 0)).toBe(1.01);
    expect(discountedUnitPrice(10.075, 0)).toBe(10.08);
    expect(discountedUnitPrice(129.99, 1)).toBe(0);
  });

  it.each([
    [-1, 0], [NaN, 0], [Infinity, 0], [Number.MAX_VALUE, 0],
    [1, -0.1], [1, 1.01], [1, NaN], [1, Infinity],
  ])('rejects invalid catalog price %s and discount %s', (price, discount) => {
    expect(() => discountedUnitPrice(price, discount)).toThrow(ValidationError);
  });

  it('sums rounded stored line amounts in integer cents', () => {
    expect(orderTotal([
      { quantity: 2, unitPrice: 97.49 }, { quantity: 1, unitPrice: 89.99 },
    ])).toBe(284.97);
    expect(orderTotal([
      { quantity: 1, unitPrice: 0.1 }, { quantity: 1, unitPrice: 0.2 },
    ])).toBe(0.3);
    expect(orderTotal([{ quantity: 3, unitPrice: 0.335 }])).toBe(1.01);
    expect(orderTotal([])).toBe(0);
  });

  it('preserves large cent values and rounds decimal discount ties without epsilon', () => {
    for (const price of [30_000_000_000_000, 30_000_000_000_000.01, 100_000_000_000.01]) {
      expect(discountedUnitPrice(price, 0)).toBe(price);
      expect(orderTotal([{ quantity: 1, unitPrice: price }])).toBe(price);
    }
    expect(discountedUnitPrice(0.05, 0.9)).toBe(0.01);
    expect(discountedUnitPrice(1e-10, 0)).toBe(0);
  });

  it('rejects non-finite line amounts and totals outside safe cents', () => {
    expect(() => orderTotal([{ quantity: 1, unitPrice: NaN }])).toThrow(ValidationError);
    expect(() => orderTotal([
      { quantity: 1, unitPrice: 50_000_000_000_000 },
      { quantity: 1, unitPrice: 50_000_000_000_000 },
    ])).toThrow(ValidationError);
  });
});
