'use client';

import { dateOnly, money, qty } from '@/lib/format';
import { useList, useListState } from '@/hooks/useList';
import { useWarehouseOptions } from '@/hooks/useOptions';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import { Badge, DataTable, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';

interface BatchRow {
  id: string;
  batchNumber: string;
  manufacturingDate: string | null;
  expiryDate: string | null;
  quantity: string;
  unitCost: string;
  product: { name: string; sku: string };
  warehouse: { name: string };
  supplier?: { name: string } | null;
}

function expiryBadge(expiryDate: string | null): string {
  if (!expiryDate) return 'IN_STOCK';
  const days = (new Date(expiryDate).getTime() - Date.now()) / 86_400_000;
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return 'EXPIRING';
  return 'IN_STOCK';
}

export default function BatchesPage() {
  const state = useListState();
  const list = useList<BatchRow>('/api/inventory/batches/list', state);
  const { options: warehouses } = useWarehouseOptions();

  return (
    <>
      <PageHeader
        title="Batches & expiry"
        subtitle="Batch-level quantities driving FEFO consumption"
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
            label="Any expiry window"
            value={state.filters.expiringInDays as string | undefined}
            options={[
              { value: '7', label: 'Expiring in 7 days' },
              { value: '15', label: 'Expiring in 15 days' },
              { value: '30', label: 'Expiring in 30 days' },
            ]}
            onChange={(value) => state.setFilter('expiringInDays', value)}
          />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={state.filters.expired === 'true'}
              onChange={(event) =>
                state.setFilter('expired', event.target.checked ? 'true' : undefined)
              }
            />
            Only expired
          </label>
        </Toolbar>

        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : (
          <>
            <DataTable<BatchRow>
              rows={list.rows}
              emptyMessage="No batches match these filters."
              columns={[
                { header: 'Batch', cell: (row) => row.batchNumber },
                { header: 'Product', cell: (row) => `${row.product.name} (${row.product.sku})` },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                { header: 'Supplier', cell: (row) => row.supplier?.name ?? '—' },
                { header: 'Manufactured', cell: (row) => dateOnly(row.manufacturingDate) },
                { header: 'Expires', cell: (row) => dateOnly(row.expiryDate) },
                { header: 'Quantity', align: 'right', cell: (row) => qty(row.quantity) },
                { header: 'Unit cost', align: 'right', cell: (row) => money(row.unitCost) },
                { header: 'Status', cell: (row) => <Badge value={expiryBadge(row.expiryDate)} /> },
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
