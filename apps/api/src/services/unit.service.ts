import { Prisma } from '@prisma/client';
import { Tx, prisma } from '../lib/prisma';
import { D } from '../lib/decimal';
import { badRequest } from '../lib/errors';

export interface UnitLike {
  id: string;
  code: string;
  dimension: string;
  factorToBase: Prisma.Decimal;
}

/**
 * Converts `quantity` expressed in `fromUnit` into `toUnit`. Both units must
 * share a dimension (COUNT / WEIGHT / VOLUME); the conversion goes through the
 * dimension base unit, e.g. 1.5 KG -> 1500 G.
 */
export function convertQuantity(
  quantity: Prisma.Decimal | number | string,
  fromUnit: UnitLike,
  toUnit: UnitLike,
): Prisma.Decimal {
  if (fromUnit.id === toUnit.id) return D(quantity);
  if (fromUnit.dimension !== toUnit.dimension) {
    throw badRequest(
      'VALIDATION_ERROR',
      `Cannot convert ${fromUnit.code} to ${toUnit.code}: incompatible dimensions.`,
    );
  }
  if (D(toUnit.factorToBase).equals(0)) {
    throw badRequest('VALIDATION_ERROR', `Unit ${toUnit.code} has an invalid conversion factor.`);
  }
  return D(quantity).times(D(fromUnit.factorToBase)).dividedBy(D(toUnit.factorToBase)).toDecimalPlaces(4);
}

/** Converts a quantity into the stocking unit of a product. */
export async function convertToProductUnit(
  organizationId: string,
  productUnitId: string,
  quantity: Prisma.Decimal | number | string,
  sourceUnitId?: string | null,
  client: Tx | typeof prisma = prisma,
): Promise<Prisma.Decimal> {
  if (!sourceUnitId || sourceUnitId === productUnitId) return D(quantity);
  const units = await client.unit.findMany({
    where: { organizationId, id: { in: [productUnitId, sourceUnitId] } },
  });
  const from = units.find((u) => u.id === sourceUnitId);
  const to = units.find((u) => u.id === productUnitId);
  if (!from || !to) throw badRequest('VALIDATION_ERROR', 'Unknown unit of measurement.');
  return convertQuantity(quantity, from, to);
}
