import { Prisma, TransactionType, ValuationMethod } from '@prisma/client';
import { Tx } from '../lib/prisma';
import { D, ZERO, weightedAverageCost } from '../lib/decimal';
import { badRequest, insufficientStock, invalidState, notFound } from '../lib/errors';

export interface OrgInventorySettings {
  allowNegativeStock: boolean;
  valuationMethod: ValuationMethod;
  useFefoForPerishables: boolean;
  allowExpiredConsumption: boolean;
  reservationTtlMinutes: number;
  adjustmentApprovalValue: Prisma.Decimal;
}

const DEFAULT_SETTINGS: OrgInventorySettings = {
  allowNegativeStock: false,
  valuationMethod: 'WEIGHTED_AVERAGE',
  useFefoForPerishables: true,
  allowExpiredConsumption: false,
  reservationTtlMinutes: 120,
  adjustmentApprovalValue: D(10_000),
};

export async function getSettings(tx: Tx, organizationId: string): Promise<OrgInventorySettings> {
  const settings = await tx.organizationSettings.findUnique({ where: { organizationId } });
  if (!settings) return DEFAULT_SETTINGS;
  return {
    allowNegativeStock: settings.allowNegativeStock,
    valuationMethod: settings.valuationMethod,
    useFefoForPerishables: settings.useFefoForPerishables,
    allowExpiredConsumption: settings.allowExpiredConsumption,
    reservationTtlMinutes: settings.reservationTtlMinutes,
    adjustmentApprovalValue: settings.adjustmentApprovalValue,
  };
}

interface LockedStock {
  id: string;
  quantity: Prisma.Decimal;
  reservedQuantity: Prisma.Decimal;
  averageCost: Prisma.Decimal;
}

/**
 * Loads the stock row with `SELECT ... FOR UPDATE` so concurrent movements on
 * the same product/warehouse serialize instead of overselling.
 */
async function lockStockRow(
  tx: Tx,
  organizationId: string,
  productId: string,
  warehouseId: string,
  variantId?: string | null,
): Promise<LockedStock> {
  const select = async (): Promise<LockedStock[]> =>
    tx.$queryRaw<LockedStock[]>`
      SELECT id, quantity, "reservedQuantity", "averageCost"
      FROM "InventoryStock"
      WHERE "productId" = ${productId}::uuid
        AND "warehouseId" = ${warehouseId}::uuid
        AND ("variantId" IS NOT DISTINCT FROM ${variantId ?? null}::uuid)
      FOR UPDATE`;

  const existing = await select();
  if (existing.length > 0) return existing[0];

  const product = await tx.product.findFirst({
    where: { id: productId, organizationId },
    select: { id: true, reorderLevel: true, minimumStockLevel: true, maximumStockLevel: true },
  });
  if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found in this organization.');

  const warehouse = await tx.warehouse.findFirst({
    where: { id: warehouseId, organizationId },
    select: { id: true },
  });
  if (!warehouse) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found in this organization.');

  await tx.inventoryStock.create({
    data: {
      organizationId,
      productId,
      warehouseId,
      variantId: variantId ?? null,
      minimumStock: product.minimumStockLevel,
      maximumStock: product.maximumStockLevel,
    },
  });

  const created = await select();
  if (created.length === 0) {
    throw badRequest('INTERNAL_ERROR', 'Unable to initialise the inventory row.');
  }
  return created[0];
}

export interface MovementInput {
  organizationId: string;
  productId: string;
  warehouseId: string;
  variantId?: string | null;
  transactionType: TransactionType;
  /** Signed change applied to the physical quantity, in the product stocking unit. */
  quantityChange: Prisma.Decimal | number | string;
  unitCost?: Prisma.Decimal | number | string;
  referenceType?: string;
  referenceId?: string;
  batchId?: string | null;
  notes?: string;
  performedBy?: string | null;
  settings?: OrgInventorySettings;
}

export interface MovementResult {
  ledgerId: string;
  quantityBefore: Prisma.Decimal;
  quantityAfter: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  averageCost: Prisma.Decimal;
}

/**
 * The single entry point for every physical stock change. It locks the stock
 * row, validates availability, updates the running quantity/valuation and
 * appends an immutable ledger record. Must be called inside a transaction.
 */
export async function applyMovement(tx: Tx, input: MovementInput): Promise<MovementResult> {
  const change = D(input.quantityChange);
  if (change.equals(0)) {
    throw badRequest('INVALID_QUANTITY', 'Stock movement quantity cannot be zero.');
  }

  const settings = input.settings ?? (await getSettings(tx, input.organizationId));
  const stock = await lockStockRow(
    tx,
    input.organizationId,
    input.productId,
    input.warehouseId,
    input.variantId,
  );

  const quantityBefore = D(stock.quantity);
  const quantityAfter = quantityBefore.plus(change);

  if (quantityAfter.lessThan(0) && !settings.allowNegativeStock) {
    throw insufficientStock(
      'Insufficient stock available for this operation.',
      { available: quantityBefore.toFixed(4), requested: change.abs().toFixed(4) },
    );
  }

  const isInbound = change.greaterThan(0);
  const providedCost = input.unitCost === undefined ? undefined : D(input.unitCost);
  const unitCost = providedCost ?? D(stock.averageCost);

  let averageCost = D(stock.averageCost);
  if (isInbound && providedCost && settings.valuationMethod === 'WEIGHTED_AVERAGE') {
    averageCost = weightedAverageCost(
      quantityBefore.lessThan(0) ? ZERO : quantityBefore,
      stock.averageCost,
      change,
      providedCost,
    );
  }

  await tx.inventoryStock.update({
    where: { id: stock.id },
    data: {
      quantity: quantityAfter,
      averageCost,
      version: { increment: 1 },
      ...(input.transactionType === 'PURCHASE' && providedCost
        ? { lastPurchaseCost: providedCost }
        : {}),
    },
  });

  const ledger = await tx.inventoryLedger.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      warehouseId: input.warehouseId,
      transactionType: input.transactionType,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      quantityBefore,
      quantityChange: change,
      quantityAfter,
      unitCost,
      totalCost: unitCost.times(change.abs()).toDecimalPlaces(4),
      batchId: input.batchId ?? null,
      notes: input.notes,
      performedBy: input.performedBy ?? null,
    },
    select: { id: true },
  });

  return { ledgerId: ledger.id, quantityBefore, quantityAfter, unitCost, averageCost };
}

export interface BatchReceiptInput {
  batchNumber: string;
  manufacturingDate?: Date | null;
  expiryDate?: Date | null;
  supplierId?: string | null;
  purchaseOrderId?: string | null;
}

/** Receives stock into a batch (creating it when unseen) and records the movement. */
export async function receiveStock(
  tx: Tx,
  input: MovementInput & { batch?: BatchReceiptInput | null },
): Promise<MovementResult> {
  const quantity = D(input.quantityChange);
  if (quantity.lessThanOrEqualTo(0)) {
    throw badRequest('INVALID_QUANTITY', 'Received quantity must be greater than zero.');
  }

  let batchId = input.batchId ?? null;
  if (input.batch?.batchNumber) {
    const batch = await tx.inventoryBatch.upsert({
      where: {
        productId_warehouseId_batchNumber: {
          productId: input.productId,
          warehouseId: input.warehouseId,
          batchNumber: input.batch.batchNumber,
        },
      },
      create: {
        organizationId: input.organizationId,
        productId: input.productId,
        warehouseId: input.warehouseId,
        batchNumber: input.batch.batchNumber,
        manufacturingDate: input.batch.manufacturingDate ?? null,
        expiryDate: input.batch.expiryDate ?? null,
        quantity,
        unitCost: input.unitCost === undefined ? ZERO : D(input.unitCost),
        supplierId: input.batch.supplierId ?? null,
        purchaseOrderId: input.batch.purchaseOrderId ?? null,
      },
      update: {
        quantity: { increment: quantity },
        ...(input.unitCost === undefined ? {} : { unitCost: D(input.unitCost) }),
      },
      select: { id: true },
    });
    batchId = batch.id;
  }

  return applyMovement(tx, { ...input, batchId });
}

export interface Allocation {
  batchId: string | null;
  batchNumber: string | null;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

/**
 * Consumes stock, allocating across batches when the product is batch tracked.
 * Perishables use FEFO (earliest expiry first), everything else FIFO.
 */
export async function consumeStock(
  tx: Tx,
  input: Omit<MovementInput, 'quantityChange'> & { quantity: Prisma.Decimal | number | string },
): Promise<{ allocations: Allocation[]; totalCost: Prisma.Decimal }> {
  const quantity = D(input.quantity);
  if (quantity.lessThanOrEqualTo(0)) {
    throw badRequest('INVALID_QUANTITY', 'Consumed quantity must be greater than zero.');
  }

  const settings = input.settings ?? (await getSettings(tx, input.organizationId));
  const product = await tx.product.findFirst({
    where: { id: input.productId, organizationId: input.organizationId },
    select: { id: true, trackBatches: true, isPerishable: true, name: true },
  });
  if (!product) throw notFound('PRODUCT_NOT_FOUND', 'Product not found in this organization.');

  if (!product.trackBatches) {
    const result = await applyMovement(tx, {
      ...input,
      quantityChange: quantity.negated(),
      settings,
    });
    return {
      allocations: [{ batchId: null, batchNumber: null, quantity, unitCost: result.unitCost }],
      totalCost: result.unitCost.times(quantity).toDecimalPlaces(4),
    };
  }

  const useFefo = product.isPerishable && settings.useFefoForPerishables;
  const batches = await tx.inventoryBatch.findMany({
    where: {
      organizationId: input.organizationId,
      productId: input.productId,
      warehouseId: input.warehouseId,
      quantity: { gt: 0 },
      ...(settings.allowExpiredConsumption
        ? {}
        : { OR: [{ expiryDate: null }, { expiryDate: { gte: new Date() } }] }),
    },
    orderBy: useFefo
      ? [{ expiryDate: 'asc' }, { createdAt: 'asc' }]
      : [{ createdAt: 'asc' }],
  });

  let remaining = quantity;
  const allocations: Allocation[] = [];
  let totalCost = ZERO;

  for (const batch of batches) {
    if (remaining.lessThanOrEqualTo(0)) break;
    const take = D(batch.quantity).greaterThanOrEqualTo(remaining) ? remaining : D(batch.quantity);
    await tx.inventoryBatch.update({
      where: { id: batch.id },
      data: { quantity: { decrement: take } },
    });
    await applyMovement(tx, {
      ...input,
      quantityChange: take.negated(),
      unitCost: batch.unitCost,
      batchId: batch.id,
      settings,
    });
    allocations.push({
      batchId: batch.id,
      batchNumber: batch.batchNumber,
      quantity: take,
      unitCost: D(batch.unitCost),
    });
    totalCost = totalCost.plus(take.times(D(batch.unitCost)));
    remaining = remaining.minus(take);
  }

  if (remaining.greaterThan(0)) {
    if (!settings.allowNegativeStock) {
      throw insufficientStock(
        `Insufficient batch stock for ${product.name}. Short by ${remaining.toFixed(4)}.`,
        { shortBy: remaining.toFixed(4) },
      );
    }
    const result = await applyMovement(tx, {
      ...input,
      quantityChange: remaining.negated(),
      settings,
    });
    allocations.push({ batchId: null, batchNumber: null, quantity: remaining, unitCost: result.unitCost });
    totalCost = totalCost.plus(remaining.times(result.unitCost));
  }

  return { allocations, totalCost: totalCost.toDecimalPlaces(4) };
}

export interface ReservationInput {
  organizationId: string;
  orderId: string;
  productId: string;
  variantId?: string | null;
  warehouseId: string;
  quantity: Prisma.Decimal | number | string;
  performedBy?: string | null;
  expiresAt?: Date | null;
}

/** Reserves available stock for an order without changing the physical quantity. */
export async function reserveStock(tx: Tx, input: ReservationInput): Promise<string> {
  const quantity = D(input.quantity);
  if (quantity.lessThanOrEqualTo(0)) {
    throw badRequest('INVALID_QUANTITY', 'Reserved quantity must be greater than zero.');
  }

  const settings = await getSettings(tx, input.organizationId);
  const stock = await lockStockRow(
    tx,
    input.organizationId,
    input.productId,
    input.warehouseId,
    input.variantId,
  );

  const available = D(stock.quantity).minus(D(stock.reservedQuantity));
  if (available.lessThan(quantity) && !settings.allowNegativeStock) {
    throw insufficientStock('Insufficient available stock to reserve.', {
      available: available.toFixed(4),
      requested: quantity.toFixed(4),
    });
  }

  await tx.inventoryStock.update({
    where: { id: stock.id },
    data: { reservedQuantity: { increment: quantity }, version: { increment: 1 } },
  });

  const reservation = await tx.inventoryReservation.create({
    data: {
      organizationId: input.organizationId,
      orderId: input.orderId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      warehouseId: input.warehouseId,
      quantity,
      status: 'ACTIVE',
      expiresAt:
        input.expiresAt ??
        new Date(Date.now() + settings.reservationTtlMinutes * 60_000),
    },
    select: { id: true },
  });

  await tx.inventoryLedger.create({
    data: {
      organizationId: input.organizationId,
      productId: input.productId,
      variantId: input.variantId ?? null,
      warehouseId: input.warehouseId,
      transactionType: 'RESERVATION',
      referenceType: 'ECOMMERCE_ORDER',
      referenceId: input.orderId,
      quantityBefore: D(stock.quantity),
      quantityChange: ZERO,
      quantityAfter: D(stock.quantity),
      unitCost: D(stock.averageCost),
      totalCost: ZERO,
      notes: `Reserved ${quantity.toFixed(4)} for order ${input.orderId}`,
      performedBy: input.performedBy ?? null,
    },
  });

  return reservation.id;
}

/** Releases active reservations (cancellation or expiry). */
export async function releaseReservations(
  tx: Tx,
  organizationId: string,
  orderId: string,
  status: 'RELEASED' | 'EXPIRED' = 'RELEASED',
  performedBy?: string | null,
): Promise<number> {
  const reservations = await tx.inventoryReservation.findMany({
    where: { organizationId, orderId, status: 'ACTIVE' },
  });

  for (const reservation of reservations) {
    const stock = await lockStockRow(
      tx,
      organizationId,
      reservation.productId,
      reservation.warehouseId,
      reservation.variantId,
    );
    const release = D(reservation.quantity);
    const newReserved = D(stock.reservedQuantity).minus(release);
    await tx.inventoryStock.update({
      where: { id: stock.id },
      data: {
        reservedQuantity: newReserved.lessThan(0) ? ZERO : newReserved,
        version: { increment: 1 },
      },
    });
    await tx.inventoryReservation.update({
      where: { id: reservation.id },
      data: { status },
    });
    await tx.inventoryLedger.create({
      data: {
        organizationId,
        productId: reservation.productId,
        variantId: reservation.variantId,
        warehouseId: reservation.warehouseId,
        transactionType: 'RELEASE',
        referenceType: 'ECOMMERCE_ORDER',
        referenceId: orderId,
        quantityBefore: D(stock.quantity),
        quantityChange: ZERO,
        quantityAfter: D(stock.quantity),
        unitCost: D(stock.averageCost),
        totalCost: ZERO,
        notes: `Released ${release.toFixed(4)} (${status.toLowerCase()})`,
        performedBy: performedBy ?? null,
      },
    });
  }

  return reservations.length;
}

/** Turns active reservations into an actual stock deduction (shipment). */
export async function consumeReservations(
  tx: Tx,
  organizationId: string,
  orderId: string,
  performedBy?: string | null,
): Promise<void> {
  const reservations = await tx.inventoryReservation.findMany({
    where: { organizationId, orderId, status: 'ACTIVE' },
  });
  if (reservations.length === 0) {
    throw invalidState('This order has no active stock reservations.');
  }

  for (const reservation of reservations) {
    const stock = await lockStockRow(
      tx,
      organizationId,
      reservation.productId,
      reservation.warehouseId,
      reservation.variantId,
    );
    const quantity = D(reservation.quantity);
    const newReserved = D(stock.reservedQuantity).minus(quantity);
    await tx.inventoryStock.update({
      where: { id: stock.id },
      data: {
        reservedQuantity: newReserved.lessThan(0) ? ZERO : newReserved,
        version: { increment: 1 },
      },
    });
    await consumeStock(tx, {
      organizationId,
      productId: reservation.productId,
      variantId: reservation.variantId,
      warehouseId: reservation.warehouseId,
      transactionType: 'SALE',
      quantity,
      referenceType: 'ECOMMERCE_ORDER',
      referenceId: orderId,
      performedBy,
      notes: `Shipment of order ${orderId}`,
    });
    await tx.inventoryReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED' },
    });
  }
}
