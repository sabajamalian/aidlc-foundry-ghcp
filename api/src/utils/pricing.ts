import { ValidationError } from './errors';

function fraction(value: number): [bigint, bigint] {
  const [coefficient, exponent = '0'] = String(value).split('e');
  const [whole, decimals = ''] = coefficient.split('.');
  const numerator = BigInt(whole + decimals);
  const scale = decimals.length - Number(exponent);
  const power = BigInt(`1${'0'.repeat(Math.abs(scale))}`);
  return scale > 0 ? [numerator, power] : [numerator * power, BigInt(1)];
}

function cents(numerator: bigint, denominator: bigint): bigint {
  // Round the exact non-negative decimal amount half up, once, to integer cents.
  const value = (numerator * BigInt(200) + denominator) / (denominator * BigInt(2));
  if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError('Price or total is outside the supported currency range');
  }
  return value;
}

function currency(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError('Order total is outside the supported currency range');
  }
  const amount = Number(value) / 100;
  const [numerator, denominator] = fraction(amount);
  if (cents(numerator, denominator) !== value) {
    throw new ValidationError('Price or total cannot be represented accurately in cents');
  }
  return amount;
}

export function discountedUnitPrice(price: number, discount: number = 0): number {
  if (!Number.isFinite(price) || price < 0 ||
      !Number.isFinite(discount) || discount < 0 || discount > 1) {
    throw new ValidationError('Catalog price and discount must be valid non-negative numbers');
  }
  const [priceNumerator, priceDenominator] = fraction(price);
  const [discountNumerator, discountDenominator] = fraction(discount);
  return currency(cents(
    priceNumerator * (discountDenominator - discountNumerator),
    priceDenominator * discountDenominator,
  ));
}

export function orderTotal(
  lines: ReadonlyArray<{ quantity: number; unitPrice: number }>,
): number {
  let totalCents = BigInt(0);
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0 ||
        !Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
      throw new ValidationError('Line quantity and stored price must be valid non-negative numbers');
    }
    const [numerator, denominator] = fraction(line.unitPrice);
    totalCents += cents(numerator * BigInt(line.quantity), denominator);
  }
  return currency(totalCents);
}
