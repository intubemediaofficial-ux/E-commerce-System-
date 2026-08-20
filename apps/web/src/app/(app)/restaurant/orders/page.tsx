'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/lib/api';
import { dateTime, money, qty } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { useWarehouseOptions } from '@/hooks/useOptions';
import { ProductPicker } from '@/components/ProductPicker';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import {
  Badge,
  ConfirmButton,
  DataTable,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';

interface OrderRow {
  id: string;
  orderNumber: string;
  status: string;
  tableNumber: string | null;
  customerName: string | null;
  totalAmount: string;
  createdAt: string;
  warehouse: { id: string; name: string };
  items: {
    id: string;
    quantity: string;
    unitPrice: string;
    product: { id: string; name: string; sku: string };
  }[];
}

interface DraftItem {
  productId: string;
  name: string;
  quantity: string;
}

const STATUS_FLOW: Record<string, string> = {
  PLACED: 'IN_KITCHEN',
  IN_KITCHEN: 'PREPARED',
};

export default function RestaurantOrdersPage() {
  const { can } = useAuth();
  const canManage = can('restaurant.order.manage');
  const state = useListState();
  const list = useList<OrderRow>('/api/restaurant/orders', state);
  const queryClient = useQueryClient();
  const { options: warehouses } = useWarehouseOptions();

  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [tableNumber, setTableNumber] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState<unknown>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/restaurant/orders'] });
  };

  const create = useMutation({
    mutationFn: async () =>
      post('/api/restaurant/orders', {
        warehouseId,
        tableNumber: tableNumber || undefined,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
        })),
      }),
    onSuccess: () => {
      setOpen(false);
      setItems([]);
      setTableNumber('');
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) =>
      post(`/api/restaurant/orders/${id}/status`, { status }),
    onSuccess: invalidate,
    onError: setError,
  });

  const complete = useMutation({
    mutationFn: async (id: string) =>
      post(`/api/restaurant/orders/${id}/complete`, {}, crypto.randomUUID()),
    onSuccess: invalidate,
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Kitchen orders"
        subtitle="Completing an order consumes recipe ingredients from kitchen stock"
        actions={
          canManage ? (
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              New order
            </button>
          ) : null
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="card">
        <Toolbar search={state.search} onSearch={state.setSearch}>
          <SelectFilter
            label="All statuses"
            value={state.filters.status as string | undefined}
            options={[
              { value: 'PLACED', label: 'Placed' },
              { value: 'IN_KITCHEN', label: 'In kitchen' },
              { value: 'PREPARED', label: 'Prepared' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
            onChange={(value) => state.setFilter('status', value)}
          />
          <SelectFilter
            label="All kitchens"
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
            <DataTable<OrderRow>
              rows={list.rows}
              emptyMessage="No kitchen orders yet."
              columns={[
                { header: 'Order', cell: (row) => row.orderNumber },
                { header: 'Placed', cell: (row) => dateTime(row.createdAt) },
                { header: 'Kitchen', cell: (row) => row.warehouse.name },
                { header: 'Table', cell: (row) => row.tableNumber ?? '—' },
                {
                  header: 'Items',
                  cell: (row) => (
                    <ul className="space-y-0.5 text-xs text-slate-500">
                      {row.items.map((item) => (
                        <li key={item.id}>
                          {item.product.name} × {qty(item.quantity)}
                        </li>
                      ))}
                    </ul>
                  ),
                },
                { header: 'Total', align: 'right', cell: (row) => money(row.totalAmount) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  cell: (row) => {
                    const next = STATUS_FLOW[row.status];
                    return (
                      <div className="flex justify-end gap-2">
                        {canManage && next ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => setStatus.mutate({ id: row.id, status: next })}
                          >
                            Mark {next.replace(/_/g, ' ').toLowerCase()}
                          </button>
                        ) : null}
                        {can('restaurant.consumption.record') &&
                        ['PLACED', 'IN_KITCHEN', 'PREPARED'].includes(row.status) ? (
                          <ConfirmButton
                            label="Complete"
                            variant="primary"
                            message={`Complete ${row.orderNumber}? Recipe ingredients are consumed from stock.`}
                            onConfirm={() => complete.mutate(row.id)}
                          />
                        ) : null}
                      </div>
                    );
                  },
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

      <Modal
        open={open}
        title="New kitchen order"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={create.isPending || !warehouseId || items.length === 0}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Creating…' : 'Place order'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kitchen warehouse">
            <select
              className="input"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              <option value="">Select…</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.value} value={warehouse.value}>
                  {warehouse.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Table number">
            <input
              className="input"
              value={tableNumber}
              onChange={(event) => setTableNumber(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <span className="label">Add menu item</span>
          <ProductPicker
            onSelect={(product) =>
              setItems((current) =>
                current.some((item) => item.productId === product.id)
                  ? current
                  : [...current, { productId: product.id, name: product.name, quantity: '1' }],
              )
            }
          />
        </div>

        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li
              key={item.productId}
              className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"
            >
              <span className="flex-1 text-sm">{item.name}</span>
              <input
                className="input max-w-[120px]"
                type="number"
                step="any"
                min="0"
                value={item.quantity}
                onChange={(event) =>
                  setItems((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, quantity: event.target.value } : row,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="text-xs text-rose-600 hover:underline"
                onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
