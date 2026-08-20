'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/lib/api';
import { dateTime, money, qty, titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { useWarehouseOptions } from '@/hooks/useOptions';
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

const REASONS = [
  'SPOILAGE',
  'EXPIRED',
  'BURNT_FOOD',
  'DAMAGED',
  'PREPARATION_WASTE',
  'CUSTOMER_RETURN',
  'STORAGE_LOSS',
  'OTHER',
];

interface WastageRow {
  id: string;
  quantity: string;
  reason: string;
  estimatedCost: string;
  notes: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string };
  warehouse: { id: string; name: string };
}

export default function WastagePage() {
  const { can } = useAuth();
  const canRecord = can('inventory.wastage');
  const state = useListState();
  const list = useList<WastageRow>('/api/inventory/wastage/list', state);
  const queryClient = useQueryClient();
  const { options: warehouses } = useWarehouseOptions();

  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('SPOILAGE');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);

  const submit = useMutation({
    mutationFn: async () =>
      post(
        '/api/inventory/wastage',
        {
          productId: product?.id,
          warehouseId,
          quantity: Number(quantity),
          reason,
          notes: notes || undefined,
        },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setOpen(false);
      setProduct(null);
      setQuantity('');
      setNotes('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['/api/inventory/wastage/list'] });
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Wastage"
        subtitle="Spoilage, preparation waste and damage written off from stock"
        actions={
          canRecord ? (
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              Record wastage
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
            label="All warehouses"
            value={state.filters.warehouseId as string | undefined}
            options={warehouses}
            onChange={(value) => state.setFilter('warehouseId', value)}
          />
          <SelectFilter
            label="All reasons"
            value={state.filters.reason as string | undefined}
            options={REASONS.map((value) => ({ value, label: titleCase(value) }))}
            onChange={(value) => state.setFilter('reason', value)}
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
            <DataTable<WastageRow>
              rows={list.rows}
              emptyMessage="No wastage recorded yet."
              columns={[
                { header: 'When', cell: (row) => dateTime(row.createdAt) },
                { header: 'Product', cell: (row) => `${row.product.name} (${row.product.sku})` },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                { header: 'Reason', cell: (row) => titleCase(row.reason) },
                { header: 'Quantity', align: 'right', cell: (row) => qty(row.quantity) },
                { header: 'Estimated cost', align: 'right', cell: (row) => money(row.estimatedCost) },
                { header: 'Notes', cell: (row) => row.notes ?? '—' },
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
        title="Record wastage"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={submit.isPending || !product || !warehouseId || !quantity}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? 'Saving…' : 'Deduct from stock'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Warehouse">
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
          <Field label="Reason">
            <select className="input" value={reason} onChange={(event) => setReason(event.target.value)}>
              {REASONS.map((value) => (
                <option key={value} value={value}>
                  {titleCase(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantity">
            <input
              className="input"
              type="number"
              step="any"
              min="0"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-3">
          <span className="label">Product</span>
          {product ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {product.name}
              <button
                type="button"
                className="text-xs text-rose-600 hover:underline"
                onClick={() => setProduct(null)}
              >
                Change
              </button>
            </div>
          ) : (
            <ProductPicker onSelect={(selected) => setProduct({ id: selected.id, name: selected.name })} />
          )}
        </div>

        <textarea
          className="input mt-3"
          rows={2}
          placeholder="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Modal>
    </>
  );
}
