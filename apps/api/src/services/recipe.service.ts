import { Prisma } from '@prisma/client';
import { Tx } from '../lib/prisma';
import { D, ZERO } from '../lib/decimal';
import { badRequest, notFound } from '../lib/errors';
import { convertToProductUnit } from './unit.service';
import { consumeStock } from './inventory.service';

export interface IngredientRequirement {
  productId: string;
  productName: string;
  quantity: Prisma.Decimal;
}

/**
 * Expands a recipe into ingredient requirements for `soldQuantity` units of the
 * recipe product, scaled by yield and per-ingredient wastage percentage, and
 * normalised to each ingredient's stocking unit.
 */
export async function expandRecipe(
  tx: Tx,
  organizationId: string,
  productId: string,
  soldQuantity: Prisma.Decimal | number | string,
): Promise<IngredientRequirement[]> {
  const recipe = await tx.recipe.findFirst({
    where: { organizationId, productId, status: 'ACTIVE' },
    include: {
      items: {
        include: { ingredientProduct: { select: { id: true, name: true, unitId: true } } },
      },
    },
  });
  if (!recipe) {
    throw notFound('NOT_FOUND', 'No active recipe found for this product.');
  }
  if (recipe.items.length === 0) {
    throw badRequest('VALIDATION_ERROR', 'Recipe has no ingredients.');
  }

  const yieldQty = D(recipe.yieldQuantity);
  if (yieldQty.lessThanOrEqualTo(0)) {
    throw badRequest('VALIDATION_ERROR', 'Recipe yield quantity must be greater than zero.');
  }
  const batches = D(soldQuantity).dividedBy(yieldQty);

  const requirements: IngredientRequirement[] = [];
  for (const item of recipe.items) {
    const wastageFactor = D(1).plus(D(item.wastagePercentage).dividedBy(100));
    const grossQuantity = D(item.quantity).times(batches).times(wastageFactor);
    const normalised = await convertToProductUnit(
      organizationId,
      item.ingredientProduct.unitId,
      grossQuantity,
      item.unitId,
      tx,
    );
    requirements.push({
      productId: item.ingredientProductId,
      productName: item.ingredientProduct.name,
      quantity: normalised.toDecimalPlaces(4),
    });
  }
  return requirements;
}

export interface ConsumptionLine {
  productId: string;
  productName: string;
  quantity: Prisma.Decimal;
  cost: Prisma.Decimal;
}

/** Deducts every ingredient of a recipe from kitchen stock through the ledger. */
export async function consumeRecipeIngredients(
  tx: Tx,
  params: {
    organizationId: string;
    warehouseId: string;
    productId: string;
    quantity: Prisma.Decimal | number | string;
    referenceType: string;
    referenceId: string;
    performedBy?: string | null;
  },
): Promise<{ lines: ConsumptionLine[]; totalCost: Prisma.Decimal }> {
  const requirements = await expandRecipe(
    tx,
    params.organizationId,
    params.productId,
    params.quantity,
  );

  const lines: ConsumptionLine[] = [];
  let totalCost = ZERO;

  for (const requirement of requirements) {
    if (requirement.quantity.lessThanOrEqualTo(0)) continue;
    const { totalCost: cost } = await consumeStock(tx, {
      organizationId: params.organizationId,
      productId: requirement.productId,
      warehouseId: params.warehouseId,
      transactionType: 'CONSUMPTION',
      quantity: requirement.quantity,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      performedBy: params.performedBy,
      notes: `Recipe consumption for ${params.referenceType} ${params.referenceId}`,
    });
    lines.push({ ...requirement, cost });
    totalCost = totalCost.plus(cost);
  }

  return { lines, totalCost: totalCost.toDecimalPlaces(4) };
}

/** Theoretical cost of one recipe yield based on current average costs. */
export async function recipeCost(
  tx: Tx,
  organizationId: string,
  recipeId: string,
): Promise<{ totalCost: Prisma.Decimal; costPerUnit: Prisma.Decimal; items: ConsumptionLine[] }> {
  const recipe = await tx.recipe.findFirst({
    where: { id: recipeId, organizationId },
    include: {
      items: { include: { ingredientProduct: { select: { id: true, name: true, unitId: true } } } },
    },
  });
  if (!recipe) throw notFound('NOT_FOUND', 'Recipe not found.');

  const items: ConsumptionLine[] = [];
  let totalCost = ZERO;

  for (const item of recipe.items) {
    const quantity = await convertToProductUnit(
      organizationId,
      item.ingredientProduct.unitId,
      D(item.quantity).times(D(1).plus(D(item.wastagePercentage).dividedBy(100))),
      item.unitId,
      tx,
    );
    const stock = await tx.inventoryStock.aggregate({
      where: { organizationId, productId: item.ingredientProductId },
      _avg: { averageCost: true },
    });
    const unitCost = D(stock._avg.averageCost ?? 0);
    const cost = quantity.times(unitCost).toDecimalPlaces(4);
    items.push({
      productId: item.ingredientProductId,
      productName: item.ingredientProduct.name,
      quantity,
      cost,
    });
    totalCost = totalCost.plus(cost);
  }

  const yieldQty = D(recipe.yieldQuantity);
  return {
    totalCost: totalCost.toDecimalPlaces(4),
    costPerUnit: yieldQty.greaterThan(0) ? totalCost.dividedBy(yieldQty).toDecimalPlaces(4) : ZERO,
    items,
  };
}
