import { Tx, prisma } from '../lib/prisma';

type Sequence = 'PO' | 'GRN' | 'TRF' | 'ADJ' | 'PRT' | 'RO' | 'EO';

const TABLES: Record<Sequence, string> = {
  PO: 'PurchaseOrder',
  GRN: 'GoodsReceipt',
  TRF: 'StockTransfer',
  ADJ: 'StockAdjustment',
  PRT: 'PurchaseReturn',
  RO: 'RestaurantOrder',
  EO: 'EcommerceOrder',
};

const COLUMNS: Record<Sequence, string> = {
  PO: 'poNumber',
  GRN: 'grnNumber',
  TRF: 'transferNumber',
  ADJ: 'adjustmentNumber',
  PRT: 'returnNumber',
  RO: 'orderNumber',
  EO: 'orderNumber',
};

/**
 * Generates a human readable document number such as `PO-2026-000042`.
 * The value is derived from a per-organization count and guarded by the
 * `(organizationId, number)` unique constraint.
 */
export async function nextDocumentNumber(
  organizationId: string,
  sequence: Sequence,
  client: Tx | typeof prisma = prisma,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${sequence}-${year}-`;
  const rows = await client.$queryRawUnsafe<{ max: string | null }[]>(
    `SELECT MAX("${COLUMNS[sequence]}") AS max FROM "${TABLES[sequence]}" WHERE "organizationId" = $1::uuid AND "${COLUMNS[sequence]}" LIKE $2`,
    organizationId,
    `${prefix}%`,
  );
  const current = rows[0]?.max ? Number(rows[0].max.slice(prefix.length)) : 0;
  return `${prefix}${String(current + 1).padStart(6, '0')}`;
}
