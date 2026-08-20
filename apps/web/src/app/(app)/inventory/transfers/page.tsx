'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/lib/api';
import { dateTime, qty } from '@/lib/format';
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

interface TransferRow {
  id: string;
  transferNumber: string;
  status: string;
  notes: string | null;
  createdAt: string;
  sourceWarehouse: { id: string; name: string };
  destinationWarehouse: { id: string; name: string };
  items: {
    id: string;
    quantity: string;
    receivedQuantity: string;
    product: { id: string; name: string; sku: string };
  }[];
}

interface DraftItem {
  productId: string;
  name: string;
  quantity: string;
}

const STATUS_ACTION: Record<string, { label: string; action: string }> = {
  REQUESTED: { label: 'Approve', action: 'approve' },
  APPROVED: { label: 'Dispatch', action: 'dispatch' },
};

export default function TransfersPage() {
  const { can } = useAuth();
  const canTransfer = can('inventory.transfer');
  const state = useListState();
  const list = useList<TransferRow>('/api/stock-transfers', state);
  const queryClient = useQueryClient();
  const { options: warehouses } = useWarehouseOptions();

  const [open, setOpen] = useState(false);
  const [sourceWarehouseId, setSource] = useState('');
  const [destinationWarehouseId, setDestination] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [receiveTransfer, setReceiveTransfer] = useState<TransferRow | null>(null);
  const [receiveLines, setReceiveLines] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/stock-transfers'] });
  };

  const create = useMutation({
    mutationFn: async () =>
      post('/api/stock-transfers', {
        sourceWarehouseId,
        destinationWarehouseId,
        notes: notes || undefined,
        submit: true,
        items: items.map((item) => ({ productId: item.productId, quantity: Number(item.quantity) })),
      }),
    onSuccess: () => {
      setOpen(false);
      setItems([]);
      setNotes('');
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const advance = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) =>
      post(`/api/stock-transfers/${id}/${action}`, {}, crypto.randomUUID()),
    onSuccess: invalidate,
    onError: setError,
  });

  const receive = useMutation({
    mutationFn: async () =>
      post(
        `/api/stock-transfers/${receiveTransfer?.id}/receive`,
        {
          items: Object.entries(receiveLines)
            .filter(([, value]) => Number(value) > 0)
            .map(([itemId, value]) => ({ itemId, quantity: Number(value) })),
        },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setReceiveTransfer(null);
      setReceiveLines({});
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const openReceive = (row: TransferRow): void => {
    setReceiveTransfer(row);
    setReceiveLines(
      Object.fromEntries(
        row.items.map((item) => [
          item.id,
          String(Math.max(Number(item.quantity) - Number(item.receivedQuantity), 0)),
        ]),
      ),
    );
  };

  const cancel = useMutation({
    mutationFn: async (id: string) => post(`/api/stock-transfers/${id}/cancel`, {}),
    onSuccess: invalidate,
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Stock transfers"
        subtitle="Move stock between warehouses and kitchens with paired ledger entries"
        actions={
          canTransfer ? (
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              New transfer
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
              { value: 'DRAFT', label: 'Draft' },
              { value: 'REQUESTED', label: 'Requested' },
              { value: 'APPROVED', label: 'Approved' },
              { value: 'DISPATCHED', label: 'Dispatched' },
              { value: 'COMPLETED', label: 'Completed' },
              { value: 'CANCELLED', label: 'Cancelled' },
            ]}
            onChange={(value) => state.setFilter('status', value)}
          />
          <SelectFilter
            label="Any source"
            value={state.filters.sourceWarehouseId as string | undefined}
            options={warehouses}
            onChange={(value) => state.setFilter('sourceWarehouseId', value)}
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
            <DataTable<TransferRow>
              rows={list.rows}
              emptyMessage="No transfers yet."
              columns={[
                { header: 'Number', cell: (row) => row.transferNumber },
                { header: 'Created', cell: (row) => dateTime(row.createdAt) },
                { header: 'From', cell: (row) => row.sourceWarehouse.name },
                { header: 'To', cell: (row) => row.destinationWarehouse.name },
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
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  cell: (row) => {
                    const next = STATUS_ACTION[row.status];
                    if (!canTransfer) return <span className="text-slate-400">—</span>;
                    if (row.status === 'DISPATCHED') {
                      return (
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            className="btn-primary"
                            onClick={() => openReceive(row)}
                          >
                            Receive
                          </button>
                          <ConfirmButton
                            label="Cancel"
                            variant="danger"
                            message={`Cancel transfer ${row.transferNumber}?`}
                            onConfirm={() => cancel.mutate(row.id)}
                          />
                        </div>
                      );
                    }
                    if (!next) return <span className="text-slate-400">—</span>;
                    return (
                      <div className="flex justify-end gap-2">
                        <ConfirmButton
                          label={next.label}
                          variant="primary"
                          message={`${next.label} transfer ${row.transferNumber}?`}
                          onConfirm={() => advance.mutate({ id: row.id, action: next.action })}
                        />
                        <ConfirmButton
                          label="Cancel"
                          variant="danger"
                          message={`Cancel transfer ${row.transferNumber}?`}
                          onConfirm={() => cancel.mutate(row.id)}
                        />
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
        title="New stock transfer"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={
                create.isPending ||
                !sourceWarehouseId ||
                !destinationWarehouseId ||
                items.length === 0
              }
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Creating…' : 'Request transfer'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Source warehouse">
            <select
              className="input"
              value={sourceWarehouseId}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="">Select…</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.value} value={warehouse.value}>
                  {warehouse.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Destination warehouse">
            <select
              className="input"
              value={destinationWarehouseId}
              onChange={(event) => setDestination(event.target.value)}
            >
              <option value="">Select…</option>
              {warehouses
                .filter((warehouse) => warehouse.value !== sourceWarehouseId)
                .map((warehouse) => (
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

        <textarea
          className="input mt-3"
          rows={2}
          placeholder="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </Modal>

      <Modal
        open={Boolean(receiveTransfer)}
        title={`Receive ${receiveTransfer?.transferNumber ?? ''}`}
        onClose={() => setReceiveTransfer(null)}
        footer={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setReceiveTransfer(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={receive.isPending}
              onClick={() => receive.mutate()}
            >
              {receive.isPending ? 'Receiving…' : 'Receive into destination'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-500">
          Receive the full quantity or edit lines for a partial receipt — the transfer stays open
          until every line is fully received.
        </p>
        <ul className="mt-3 space-y-2">
          {(receiveTransfer?.items ?? []).map((item) => {
            const outstanding = Number(item.quantity) - Number(item.receivedQuantity);
            return (
              <li
                key={item.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"
              >
                <span className="flex-1 text-sm">
                  {item.product.name}
                  <span className="ml-2 text-xs text-slate-400">
                    sent {qty(item.quantity)} · received {qty(item.receivedQuantity)} · outstanding{' '}
                    {qty(outstanding)}
                  </span>
                </span>
                <input
                  className="input max-w-[130px]"
                  type="number"
                  step="any"
                  min="0"
                  max={outstanding}
                  value={receiveLines[item.id] ?? ''}
                  onChange={(event) =>
                    setReceiveLines((current) => ({ ...current, [item.id]: event.target.value }))
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
