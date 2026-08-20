'use client';

import { dateTime, qty } from '@/lib/format';
import { useList, useListState } from '@/hooks/useList';
import { useWarehouseOptions } from '@/hooks/useOptions';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import { Badge, DataTable, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';

interface ReservationRow {
  id: string;
  quantity: string;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string };
  warehouse: { id: string; name: string };
  order: { id: string; orderNumber: string; status: string };
}

export default function ReservationsPage() {
  const state = useListState({ status: 'ACTIVE' });
  const list = useList<ReservationRow>('/api/ecommerce/reservations', state);
  const { options: warehouses } = useWarehouseOptions();

  return (
    <>
      <PageHeader
        title="Stock reservations"
        subtitle="Reserved quantities held against confirmed orders"
      />

      <div className="card">
        <Toolbar>
          <SelectFilter
            label="All statuses"
            value={state.filters.status as string | undefined}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'RELEASED', label: 'Released' },
              { value: 'CONSUMED', label: 'Consumed' },
              { value: 'EXPIRED', label: 'Expired' },
            ]}
            onChange={(value) => state.setFilter('status', value)}
          />
          <SelectFilter
            label="All warehouses"
            value={state.filters.warehouseId as string | undefined}
            options={warehouses}
            onChange={(value) => state.setFilter('warehouseId', value)}
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
            <DataTable<ReservationRow>
              rows={list.rows}
              emptyMessage="No reservations for these filters."
              columns={[
                { header: 'Order', cell: (row) => row.order.orderNumber },
                { header: 'Product', cell: (row) => `${row.product.name} (${row.product.sku})` },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                { header: 'Quantity', align: 'right', cell: (row) => qty(row.quantity) },
                { header: 'Created', cell: (row) => dateTime(row.createdAt) },
                { header: 'Expires', cell: (row) => dateTime(row.expiresAt) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
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
