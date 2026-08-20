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

const REASONS = [
  'PHYSICAL_COUNT',
  'DAMAGE',
  'EXPIRED',
  'MISSING',
  'FOUND',
  'DATA_CORRECTION',
  'OPENING_STOCK',
];

interface AdjustmentRow {
  id: string;
  adjustmentNumber?: string;
  reason: string;
  status: string;
  notes: string | null;
  totalValue: string;
  createdAt: string;
  warehouse: { id: string; name: string };
  items: {
    id: string;
    quantityChange: string;
    unitCost: string;
    product: { id: string; name: string; sku: string };
  }[];
}

interface DraftItem {
  productId: string;
  name: string;
  sku: string;
  quantityChange: string;
  unitCost: string;
}

export default function AdjustmentsPage() {
  const { can } = useAuth();
  const canAdjust = can('inventory.adjust');
  const state = useListState();
  const list = useList<AdjustmentRow>('/api/inventory/adjustments/list', state);
  const queryClient = useQueryClient();
  const { options: warehouses } = useWarehouseOptions();

  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('PHYSICAL_COUNT');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState<unknown>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/inventory/adjustments/list'] });
  };

  const submit = useMutation({
    mutationFn: async () =>
      post(
        '/api/inventory/adjust',
        {
          warehouseId,
          reason,
          notes: notes || undefined,
          items: items.map((item) => ({
            productId: item.productId,
            quantityChange: Number(item.quantityChange),
            unitCost: item.unitCost ? Number(item.unitCost) : undefined,
          })),
        },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setOpen(false);
      setItems([]);
      setNotes('');
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const approve = useMutation({
    mutationFn: async (id: string) => post(`/api/inventory/adjustments/${id}/approve`),
    onSuccess: invalidate,
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Stock adjustments"
        subtitle="Counted corrections with reason, approval and ledger trail"
        actions={
          canAdjust ? (
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              New adjustment
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
            label="All statuses"
            value={state.filters.status as string | undefined}
            options={[
              { value: 'PENDING_APPROVAL', label: 'Pending approval' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'REJECTED', label: 'Rejected' },
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
            <DataTable<AdjustmentRow>
              rows={list.rows}
              emptyMessage="No adjustments recorded yet."
              columns={[
                { header: 'When', cell: (row) => dateTime(row.createdAt) },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                { header: 'Reason', cell: (row) => titleCase(row.reason) },
                {
                  header: 'Items',
                  cell: (row) => (
                    <ul className="space-y-0.5 text-xs text-slate-500">
                      {row.items.map((item) => (
                        <li key={item.id}>
                          {item.product.name}: {qty(item.quantityChange)}
                        </li>
                      ))}
                    </ul>
                  ),
                },
                { header: 'Value', align: 'right', cell: (row) => money(row.totalValue) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  cell: (row) =>
                    canAdjust && row.status === 'PENDING_APPROVAL' ? (
                      <ConfirmButton
                        label="Approve"
                        variant="primary"
                        message="Approve this adjustment? Stock and the ledger update immediately."
                        onConfirm={() => approve.mutate(row.id)}
                      />
                    ) : (
                      <span className="text-slate-400">—</span>
                    ),
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
        title="New stock adjustment"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={submit.isPending || !warehouseId || items.length === 0}
              onClick={() => submit.mutate()}
            >
              {submit.isPending ? 'Submitting…' : 'Submit adjustment'}
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
        </div>

        <div className="mt-4">
          <span className="label">Add product</span>
          <ProductPicker
            onSelect={(product) =>
              setItems((current) =>
                current.some((item) => item.productId === product.id)
                  ? current
                  : [
                      ...current,
                      {
                        productId: product.id,
                        name: product.name,
                        sku: product.sku,
                        quantityChange: '0',
                        unitCost: product.purchasePrice,
                      },
                    ],
              )
            }
          />
        </div>

        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li key={item.productId} className="rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {item.name} <span className="text-xs text-slate-400">{item.sku}</span>
                </p>
                <button
                  type="button"
                  className="text-xs text-rose-600 hover:underline"
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="Quantity change" hint="Negative reduces stock">
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={item.quantityChange}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, quantityChange: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>
                <Field label="Unit cost">
                  <input
                    className="input"
                    type="number"
                    step="any"
                    value={item.unitCost}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, unitCost: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>

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
