'use client';

import { download } from '@/lib/api';
import { money, qty, titleCase } from '@/lib/format';
import { useList, useListState } from '@/hooks/useList';
import { useCategoryOptions, useWarehouseOptions } from '@/hooks/useOptions';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import {
  Badge,
  DataTable,
  ErrorState,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';
import type { StockRow } from '@/lib/types';

export default function InventoryPage() {
  const state = useListState();
  const list = useList<StockRow>('/api/inventory', state);
  const { options: warehouses } = useWarehouseOptions();
  const { options: categories } = useCategoryOptions();

  return (
    <>
      <PageHeader
        title="Stock on hand"
        subtitle="Physical, reserved and available quantities per warehouse"
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              void download('/api/reports/current-stock', {
                format: 'csv',
                warehouseId: state.filters.warehouseId as string | undefined,
              })
            }
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
            label="All categories"
            value={state.filters.categoryId as string | undefined}
            options={categories}
            onChange={(value) => state.setFilter('categoryId', value)}
          />
          <SelectFilter
            label="All statuses"
            value={state.filters.status as string | undefined}
            options={[
              { value: 'IN_STOCK', label: 'In stock' },
              { value: 'LOW_STOCK', label: 'Low stock' },
              { value: 'OUT_OF_STOCK', label: 'Out of stock' },
            ]}
            onChange={(value) => state.setFilter('status', value)}
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
            <DataTable<StockRow>
              rows={list.rows}
              emptyMessage="No stock rows match these filters."
              columns={[
                { header: 'Product', cell: (row) => row.product.name },
                { header: 'SKU', cell: (row) => row.variant?.sku ?? row.product.sku },
                {
                  header: 'Warehouse',
                  cell: (row) => (
                    <span>
                      {row.warehouse.name}
                      <span className="ml-1 text-xs text-slate-400">
                        {titleCase(row.warehouse.type)}
                      </span>
                    </span>
                  ),
                },
                { header: 'Stock', align: 'right', cell: (row) => qty(row.quantity) },
                { header: 'Reserved', align: 'right', cell: (row) => qty(row.reservedQuantity) },
                { header: 'Available', align: 'right', cell: (row) => qty(row.availableQuantity) },
                { header: 'Reorder level', align: 'right', cell: (row) => qty(row.product.reorderLevel) },
                { header: 'Avg cost', align: 'right', cell: (row) => money(row.averageCost) },
                { header: 'Value', align: 'right', cell: (row) => money(row.stockValue) },
                { header: 'Status', cell: (row) => <Badge value={row.stockStatus} /> },
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
