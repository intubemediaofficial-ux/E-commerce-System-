import { Prisma } from '@prisma/client';

export type Numeric = Prisma.Decimal | number | string;

export const D = (value: Numeric): Prisma.Decimal => new Prisma.Decimal(value);

export const ZERO = new Prisma.Decimal(0);

export const toNumber = (value: Numeric): number => D(value).toNumber();

export const isNegative = (value: Numeric): boolean => D(value).lessThan(0);

/**
 * Weighted average cost:
 * ((oldQty * oldCost) + (newQty * newCost)) / (oldQty + newQty)
 */
export function weightedAverageCost(
  oldQuantity: Numeric,
  oldCost: Numeric,
  incomingQuantity: Numeric,
  incomingCost: Numeric,
): Prisma.Decimal {
  const oldQty = D(oldQuantity);
  const newQty = D(incomingQuantity);
  const totalQty = oldQty.plus(newQty);
  if (totalQty.lessThanOrEqualTo(0)) return D(incomingCost);
  return oldQty
    .times(D(oldCost))
    .plus(newQty.times(D(incomingCost)))
    .dividedBy(totalQty)
    .toDecimalPlaces(4);
}
