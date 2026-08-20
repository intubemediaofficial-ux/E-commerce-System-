'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/lib/api';
import { dateTime, money, qty } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { useSupplierOptions, useWarehouseOptions } from '@/hooks/useOptions';
import { ProductPicker } from '@/components/ProductPicker';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import {
  DataTable,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';

interface ReturnRow {
  id: string;
  returnNumber: string;
  reason: string | null;
  totalValue: string;
  createdAt: string;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string };
  items: { id: string; quantity: string; product: { id: string; name: string; sku: string } }[];
}

interface DraftItem {
  productId: string;
  name: string;
  quantity: string;
}

export default function PurchaseReturnsPage() {
  const { can } = useAuth();
  const state = useListState();
  const list = useList<ReturnRow>('/api/purchase-returns', state);
  const queryClient = useQueryClient();
  const { options: suppliers } = useSupplierOptions();
  const { options: warehouses } = useWarehouseOptions();

  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState<unknown>(null);

  const create = useMutation({
    mutationFn: async () =>
      post(
        '/api/purchase-returns',
        {
          supplierId,
          warehouseId,
          reason: reason || undefined,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
          })),
        },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setOpen(false);
      setItems([]);
      setReason('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['/api/purchase-returns'] });
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Purchase returns"
        subtitle="Send stock back to suppliers with a matching ledger deduction"
        actions={
          can('purchase.return') ? (
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              New return
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
        <Toolbar>
          <SelectFilter
            label="All suppliers"
            value={state.filters.supplierId as string | undefined}
            options={suppliers}
            onChange={(value) => state.setFilter('supplierId', value)}
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
            <DataTable<ReturnRow>
              rows={list.rows}
              emptyMessage="No purchase returns yet."
              columns={[
                { header: 'Number', cell: (row) => row.returnNumber },
                { header: 'When', cell: (row) => dateTime(row.createdAt) },
                { header: 'Supplier', cell: (row) => row.supplier.name },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                {
                  header: 'Items',
                  cell: (row) => (
                    <ul className="space-y-0.5 text-xs text-slate-500">
                      {row.items.map((item) => (
                        <li key={item.id}>
                          {item.product.name}: {qty(item.quantity)}
                        </li>
                      ))}
                    </ul>
                  ),
                },
                { header: 'Value', align: 'right', cell: (row) => money(row.totalValue) },
                { header: 'Reason', cell: (row) => row.reason ?? '—' },
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
        title="New purchase return"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={create.isPending || !supplierId || !warehouseId || items.length === 0}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Saving…' : 'Return to supplier'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier">
            <select
              className="input"
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
            >
              <option value="">Select…</option>
              {suppliers.map((supplier) => (
                <option key={supplier.value} value={supplier.value}>
                  {supplier.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From warehouse">
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

        <input
          className="input mt-3"
          placeholder="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Modal>
    </>
  );
}
