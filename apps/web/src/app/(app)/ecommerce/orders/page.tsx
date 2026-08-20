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
  customerName: string | null;
  customerEmail: string | null;
  grandTotal: string;
  createdAt: string;
  warehouse: { id: string; name: string };
  items: {
    id: string;
    quantity: string;
    returnedQuantity: string;
    product: { id: string; name: string; sku: string };
  }[];
}

interface DraftItem {
  productId: string;
  name: string;
  quantity: string;
}

/** Workflow step available from each status. */
const NEXT_STEP: Record<string, { label: string; action: string }> = {
  CREATED: { label: 'Confirm & reserve', action: 'confirm' },
  CONFIRMED: { label: 'Pack', action: 'pack' },
  PACKED: { label: 'Ship', action: 'ship' },
  SHIPPED: { label: 'Complete', action: 'complete' },
};

export default function EcommerceOrdersPage() {
  const { can } = useAuth();
  const canManage = can('ecommerce.order.manage');
  const state = useListState();
  const list = useList<OrderRow>('/api/ecommerce/orders', state);
  const queryClient = useQueryClient();
  const { options: warehouses } = useWarehouseOptions();

  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [returnOrder, setReturnOrder] = useState<OrderRow | null>(null);
  const [returnLines, setReturnLines] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/ecommerce/orders'] });
    void queryClient.invalidateQueries({ queryKey: ['/api/ecommerce/reservations'] });
  };

  const create = useMutation({
    mutationFn: async () =>
      post('/api/ecommerce/orders', {
        warehouseId,
        customerName: customerName || undefined,
        customerEmail: customerEmail || undefined,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
        })),
      }),
    onSuccess: () => {
      setOpen(false);
      setItems([]);
      setCustomerName('');
      setCustomerEmail('');
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const advance = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) =>
      post(`/api/ecommerce/orders/${id}/${action}`, {}, crypto.randomUUID()),
    onSuccess: invalidate,
    onError: setError,
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => post(`/api/ecommerce/orders/${id}/cancel`, {}),
    onSuccess: invalidate,
    onError: setError,
  });

  const submitReturn = useMutation({
    mutationFn: async () =>
      post(
        `/api/ecommerce/orders/${returnOrder?.id}/return`,
        {
          restock: true,
          items: Object.entries(returnLines)
            .filter(([, value]) => Number(value) > 0)
            .map(([orderItemId, value]) => ({ orderItemId, quantity: Number(value) })),
        },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setReturnOrder(null);
      setReturnLines({});
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="E-commerce orders"
        subtitle="Confirmation reserves stock; shipment consumes it from the ledger"
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
              'CREATED',
              'CONFIRMED',
              'PACKED',
              'SHIPPED',
              'COMPLETED',
              'CANCELLED',
              'RETURNED',
            ].map((value) => ({ value, label: value.toLowerCase() }))}
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
            <DataTable<OrderRow>
              rows={list.rows}
              emptyMessage="No orders yet."
              columns={[
                { header: 'Order', cell: (row) => row.orderNumber },
                { header: 'Placed', cell: (row) => dateTime(row.createdAt) },
                {
                  header: 'Customer',
                  cell: (row) => row.customerName ?? row.customerEmail ?? 'Guest',
                },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
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
                { header: 'Total', align: 'right', cell: (row) => money(row.grandTotal) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  cell: (row) => {
                    const next = NEXT_STEP[row.status];
                    return (
                      <div className="flex flex-wrap justify-end gap-2">
                        {canManage && next ? (
                          <ConfirmButton
                            label={next.label}
                            variant="primary"
                            message={`${next.label} for ${row.orderNumber}?`}
                            onConfirm={() => advance.mutate({ id: row.id, action: next.action })}
                          />
                        ) : null}
                        {canManage && ['CREATED', 'CONFIRMED', 'PACKED'].includes(row.status) ? (
                          <ConfirmButton
                            label="Cancel"
                            variant="danger"
                            message={`Cancel ${row.orderNumber}? Reservations are released.`}
                            onConfirm={() => cancel.mutate(row.id)}
                          />
                        ) : null}
                        {canManage && ['SHIPPED', 'COMPLETED'].includes(row.status) ? (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() => {
                              setReturnOrder(row);
                              setReturnLines({});
                            }}
                          >
                            Return
                          </button>
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
        title="New e-commerce order"
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
              {create.isPending ? 'Creating…' : 'Create order'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fulfilment warehouse">
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
          <Field label="Customer name">
            <input
              className="input"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
          </Field>
          <Field label="Customer email">
            <input
              className="input"
              type="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <span className="label">Add product</span>
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

      <Modal
        open={Boolean(returnOrder)}
        title={`Return items · ${returnOrder?.orderNumber ?? ''}`}
        onClose={() => setReturnOrder(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReturnOrder(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={submitReturn.isPending}
              onClick={() => submitReturn.mutate()}
            >
              {submitReturn.isPending ? 'Restocking…' : 'Validate & restock'}
            </button>
          </>
        }
      >
        <ul className="space-y-2">
          {(returnOrder?.items ?? []).map((item) => {
            const returnable = Number(item.quantity) - Number(item.returnedQuantity);
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"
              >
                <span className="flex-1 text-sm">
                  {item.product.name}
                  <span className="ml-2 text-xs text-slate-400">
                    shipped {qty(item.quantity)} · returnable {qty(returnable)}
                  </span>
                </span>
                <input
                  className="input max-w-[130px]"
                  type="number"
                  step="any"
                  min="0"
                  max={returnable}
                  placeholder="0"
                  value={returnLines[item.id] ?? ''}
                  onChange={(event) =>
                    setReturnLines((current) => ({ ...current, [item.id]: event.target.value }))
                  }
                />
              </li>
            );
          })}
        </ul>
      </Modal>
    </>
  );
}
