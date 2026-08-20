'use client';

import { dateOnly, qty } from '@/lib/format';
import { useList, useListState } from '@/hooks/useList';
import { useSupplierOptions, useWarehouseOptions } from '@/hooks/useOptions';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import { DataTable, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';

interface ReceiptRow {
  id: string;
  grnNumber: string;
  receivedDate: string;
  invoiceNumber: string | null;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string };
  purchaseOrder: { id: string; poNumber: string } | null;
  items: { id: string; quantity: string }[];
}

export default function GoodsReceiptsPage() {
  const state = useListState();
  const list = useList<ReceiptRow>('/api/purchase-orders/receipts/list', state);
  const { options: suppliers } = useSupplierOptions();
  const { options: warehouses } = useWarehouseOptions();

  return (
    <>
      <PageHeader title="Goods receipts" subtitle="GRNs generated when purchased stock arrives" />

      <div className="card">
        <Toolbar>
          <SelectFilter
            label="All suppliers"
            value={state.filters.supplierId as string | undefined}
            options={suppliers}
            onChange={(value) => state.setFilter('supplierId', value)}
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
            <DataTable<ReceiptRow>
              rows={list.rows}
              emptyMessage="No goods receipts recorded yet."
              columns={[
                { header: 'GRN', cell: (row) => row.grnNumber },
                { header: 'Received', cell: (row) => dateOnly(row.receivedDate) },
                { header: 'Purchase order', cell: (row) => row.purchaseOrder?.poNumber ?? '—' },
                { header: 'Supplier', cell: (row) => row.supplier.name },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                { header: 'Invoice', cell: (row) => row.invoiceNumber ?? '—' },
                {
                  header: 'Units received',
                  align: 'right',
                  cell: (row) =>
                    qty(row.items.reduce((sum, item) => sum + Number(item.quantity), 0)),
                },
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
