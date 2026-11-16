import { ValidationError } from './errors';

function cents(amount: number): number {
  const value = Math.round((amount + Number.EPSILON * Math.max(1, amount)) * 100);
  if (!Number.isFinite(amount) || amount < 0 || !Number.isSafeInteger(value)) {
    throw new ValidationError('Price or total is outside the supported currency range');
  }
  return value;
}

export function discountedUnitPrice(price: number, discount: number = 0): number {
  if (!Number.isFinite(price) || price < 0 ||
      !Number.isFinite(discount) || discount < 0 || discount > 1) {
    throw new ValidationError('Catalog price and discount must be valid non-negative numbers');
  }
  return cents(price * (1 - discount)) / 100;
}

export function orderTotal(
  lines: ReadonlyArray<{ quantity: number; unitPrice: number }>,
): number {
  let totalCents = 0;
  for (const line of lines) {
    totalCents += cents(line.quantity * line.unitPrice);
    if (!Number.isSafeInteger(totalCents)) {
      throw new ValidationError('Order total is outside the supported currency range');
    }
  }
  return totalCents / 100;
}
