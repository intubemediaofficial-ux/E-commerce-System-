'use client';

import { download } from '@/lib/api';
import { dateTime, money, qty, titleCase } from '@/lib/format';
import { useList, useListState } from '@/hooks/useList';
import { useWarehouseOptions } from '@/hooks/useOptions';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import { DataTable, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';

const TRANSACTION_TYPES = [
  'PURCHASE',
  'SALE',
  'SALE_RETURN',
  'PURCHASE_RETURN',
  'STOCK_TRANSFER_OUT',
  'STOCK_TRANSFER_IN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'WASTAGE',
  'EXPIRY',
  'PRODUCTION',
  'CONSUMPTION',
];

interface LedgerApiRow {
  id: string;
  createdAt: string;
  transactionType: string;
  referenceType: string | null;
  quantityBefore: string;
  quantityChange: string;
  quantityAfter: string;
  unitCost: string;
  totalCost: string;
  product: { name: string; sku: string };
  warehouse: { name: string };
  batch?: { batchNumber: string } | null;
  user?: { name: string } | null;
}

export default function LedgerPage() {
  const state = useListState();
  const list = useList<LedgerApiRow>('/api/inventory/ledger', state, 25);
  const { options: warehouses } = useWarehouseOptions();

  return (
    <>
      <PageHeader
        title="Stock ledger"
        subtitle="Immutable record of every physical stock movement"
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void download('/api/reports/stock-ledger', { format: 'csv' })}
          >
            Export CSV
          </button>
        }
      />

      <div className="card">
        <Toolbar>
          <SelectFilter
            label="All warehouses"
            value={state.filters.warehouseId as string | undefined}
            options={warehouses}
            onChange={(value) => state.setFilter('warehouseId', value)}
          />
          <SelectFilter
            label="All transaction types"
            value={state.filters.transactionType as string | undefined}
            options={TRANSACTION_TYPES.map((type) => ({ value: type, label: titleCase(type) }))}
            onChange={(value) => state.setFilter('transactionType', value)}
          />
          <input
            type="date"
            className="input max-w-[170px]"
            value={(state.filters.from as string) ?? ''}
            onChange={(event) => state.setFilter('from', event.target.value || undefined)}
          />
          <input
            type="date"
            className="input max-w-[170px]"
            value={(state.filters.to as string) ?? ''}
            onChange={(event) => state.setFilter('to', event.target.value || undefined)}
          />
        </Toolbar>

        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : (
          <>
            <DataTable<LedgerApiRow>
              rows={list.rows}
              emptyMessage="No ledger entries for these filters."
              columns={[
                { header: 'When', cell: (row) => dateTime(row.createdAt) },
                { header: 'Product', cell: (row) => `${row.product.name} (${row.product.sku})` },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                { header: 'Type', cell: (row) => titleCase(row.transactionType) },
                { header: 'Reference', cell: (row) => row.referenceType ?? '—' },
                { header: 'Batch', cell: (row) => row.batch?.batchNumber ?? '—' },
                { header: 'Before', align: 'right', cell: (row) => qty(row.quantityBefore) },
                { header: 'Change', align: 'right', cell: (row) => qty(row.quantityChange) },
                { header: 'After', align: 'right', cell: (row) => qty(row.quantityAfter) },
                { header: 'Value', align: 'right', cell: (row) => money(row.totalCost) },
                { header: 'By', cell: (row) => row.user?.name ?? 'System' },
              ]}
            />
            <Pagination
              page={list.meta.page}
              totalPages={list.meta.totalPages}
              total={list.meta.total}
              onChange={state.setPage}
            />
          </>
        )}
      </div>
    </>
  );
}
