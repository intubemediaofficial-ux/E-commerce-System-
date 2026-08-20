'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { get, post } from '@/lib/api';
import { dateOnly, money, qty } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { useSupplierOptions, useWarehouseOptions } from '@/hooks/useOptions';
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

interface PoListRow {
  id: string;
  poNumber: string;
  status: string;
  orderDate: string;
  expectedDeliveryDate: string | null;
  grandTotal: string;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string };
  items: { id: string; productId: string; quantity: string; receivedQuantity: string }[];
}

interface PoDetail extends PoListRow {
  notes: string | null;
  items: {
    id: string;
    productId: string;
    quantity: string;
    receivedQuantity: string;
    unitCost: string;
    total: string;
    product: { id: string; name: string; sku: string };
  }[];
}

interface ReceiveBatch {
  batchNumber?: string;
  manufacturingDate?: string;
  expiryDate?: string;
}

interface DraftItem {
  productId: string;
  name: string;
  quantity: string;
  unitCost: string;
  taxRate: string;
}

const STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'FULLY_RECEIVED',
  'CLOSED',
  'CANCELLED',
];

export default function PurchaseOrdersPage() {
  const { can } = useAuth();
  const state = useListState();
  const list = useList<PoListRow>('/api/purchase-orders', state);
  const queryClient = useQueryClient();
  const { options: suppliers } = useSupplierOptions();
  const { options: warehouses } = useWarehouseOptions();

  const [createOpen, setCreateOpen] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expected, setExpected] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [receiveId, setReceiveId] = useState<string | null>(null);
  const [receiveLines, setReceiveLines] = useState<Record<string, string>>({});
  const [receiveBatches, setReceiveBatches] = useState<Record<string, ReceiveBatch>>({});
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [error, setError] = useState<unknown>(null);

  const detail = useQuery({
    queryKey: ['/api/purchase-orders', receiveId],
    queryFn: async () => (await get<PoDetail>(`/api/purchase-orders/${receiveId}`)).data,
    enabled: Boolean(receiveId),
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/purchase-orders'] });
  };

  const create = useMutation({
    mutationFn: async () =>
      post('/api/purchase-orders', {
        supplierId,
        warehouseId,
        expectedDeliveryDate: expected || undefined,
        submit: true,
        items: items.map((item) => ({
          productId: item.productId,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          taxRate: Number(item.taxRate || 0),
        })),
      }),
    onSuccess: () => {
      setCreateOpen(false);
      setItems([]);
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const approve = useMutation({
    mutationFn: async (id: string) => post(`/api/purchase-orders/${id}/approve`, {}),
    onSuccess: invalidate,
    onError: setError,
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => post(`/api/purchase-orders/${id}/cancel`, {}),
    onSuccess: invalidate,
    onError: setError,
  });

  const receive = useMutation({
    mutationFn: async () =>
      post(
        `/api/purchase-orders/${receiveId}/receive`,
        {
          invoiceNumber: invoiceNumber || undefined,
          items: Object.entries(receiveLines)
            .filter(([, value]) => Number(value) > 0)
            .map(([purchaseOrderItemId, value]) => {
              const batch = receiveBatches[purchaseOrderItemId];
              return {
                purchaseOrderItemId,
                quantity: Number(value),
                batchNumber: batch?.batchNumber || undefined,
                manufacturingDate: batch?.manufacturingDate || undefined,
                expiryDate: batch?.expiryDate || undefined,
              };
            }),
        },
        crypto.randomUUID(),
      ),
    onSuccess: () => {
      setReceiveId(null);
      setReceiveLines({});
      setReceiveBatches({});
      setInvoiceNumber('');
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle="Raise, approve and receive supplier orders"
        actions={
          can('purchase.create') ? (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              New purchase order
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
            options={STATUSES.map((value) => ({ value, label: value.replace(/_/g, ' ') }))}
            onChange={(value) => state.setFilter('status', value)}
          />
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
            <DataTable<PoListRow>
              rows={list.rows}
              emptyMessage="No purchase orders yet."
              columns={[
                { header: 'PO number', cell: (row) => row.poNumber },
                { header: 'Supplier', cell: (row) => row.supplier.name },
                { header: 'Warehouse', cell: (row) => row.warehouse.name },
                { header: 'Ordered', cell: (row) => dateOnly(row.orderDate) },
                { header: 'Expected', cell: (row) => dateOnly(row.expectedDeliveryDate) },
                { header: 'Lines', align: 'right', cell: (row) => String(row.items.length) },
                { header: 'Total', align: 'right', cell: (row) => money(row.grandTotal) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  cell: (row) => (
                    <div className="flex justify-end gap-2">
                      {can('purchase.approve') && row.status === 'SUBMITTED' ? (
                        <ConfirmButton
                          label="Approve"
                          variant="primary"
                          message={`Approve ${row.poNumber}?`}
                          onConfirm={() => approve.mutate(row.id)}
                        />
                      ) : null}
                      {can('purchase.receive') &&
                      ['APPROVED', 'PARTIALLY_RECEIVED'].includes(row.status) ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setReceiveId(row.id);
                            setReceiveLines({});
                          }}
                        >
                          Receive
                        </button>
                      ) : null}
                      {can('purchase.create') &&
                      ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status) ? (
                        <ConfirmButton
                          label="Cancel"
                          variant="danger"
                          message={`Cancel ${row.poNumber}?`}
                          onConfirm={() => cancel.mutate(row.id)}
                        />
                      ) : null}
                    </div>
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
        open={createOpen}
        title="New purchase order"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={create.isPending || !supplierId || !warehouseId || items.length === 0}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Creating…' : 'Submit order'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
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
          <Field label="Deliver to warehouse">
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
          <Field label="Expected delivery">
            <input
              className="input"
              type="date"
              value={expected}
              onChange={(event) => setExpected(event.target.value)}
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
                  : [
                      ...current,
                      {
                        productId: product.id,
                        name: product.name,
                        quantity: '1',
                        unitCost: product.purchasePrice,
                        taxRate: product.taxRate,
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
                <p className="text-sm font-medium">{item.name}</p>
                <button
                  type="button"
                  className="text-xs text-rose-600 hover:underline"
                  onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Field label="Quantity">
                  <input
                    className="input"
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
                </Field>
                <Field label="Unit cost">
                  <input
                    className="input"
                    type="number"
                    step="any"
                    min="0"
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
                <Field label="Tax %">
                  <input
                    className="input"
                    type="number"
                    step="any"
                    min="0"
                    value={item.taxRate}
                    onChange={(event) =>
                      setItems((current) =>
                        current.map((row, i) =>
                          i === index ? { ...row, taxRate: event.target.value } : row,
                        ),
                      )
                    }
                  />
                </Field>
              </div>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={Boolean(receiveId)}
        title="Receive goods"
        onClose={() => setReceiveId(null)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setReceiveId(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={receive.isPending}
              onClick={() => receive.mutate()}
            >
              {receive.isPending ? 'Receiving…' : 'Receive into stock'}
            </button>
          </>
        }
      >
        {detail.isPending ? (
          <Spinner />
        ) : (
          <>
            <Field label="Supplier invoice number">
              <input
                className="input"
                value={invoiceNumber}
                onChange={(event) => setInvoiceNumber(event.target.value)}
              />
            </Field>
            <ul className="mt-3 space-y-2">
              {(detail.data?.items ?? []).map((item) => {
                const outstanding = Number(item.quantity) - Number(item.receivedQuantity);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <span className="flex-1 text-sm">
                      {item.product.name}
                      <span className="ml-2 text-xs text-slate-400">
                        ordered {qty(item.quantity)} · received {qty(item.receivedQuantity)} ·
                        outstanding {qty(outstanding)}
                      </span>
                    </span>
                    <input
                      className="input max-w-[130px]"
                      type="number"
                      step="any"
                      min="0"
                      max={outstanding}
                      placeholder="0"
                      value={receiveLines[item.id] ?? ''}
                      onChange={(event) =>
                        setReceiveLines((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                    />
                    <div className="grid w-full gap-2 sm:grid-cols-3">
                      <Field label="Batch number">
                        <input
                          className="input"
                          value={receiveBatches[item.id]?.batchNumber ?? ''}
                          onChange={(event) =>
                            setReceiveBatches((current) => ({
                              ...current,
                              [item.id]: { ...current[item.id], batchNumber: event.target.value },
                            }))
                          }
                        />
                      </Field>
                      <Field label="Manufactured">
                        <input
                          className="input"
                          type="date"
                          value={receiveBatches[item.id]?.manufacturingDate ?? ''}
                          onChange={(event) =>
                            setReceiveBatches((current) => ({
                              ...current,
                              [item.id]: {
                                ...current[item.id],
                                manufacturingDate: event.target.value,
                              },
                            }))
                          }
                        />
                      </Field>
                      <Field label="Expires">
                        <input
                          className="input"
                          type="date"
                          value={receiveBatches[item.id]?.expiryDate ?? ''}
                          onChange={(event) =>
                            setReceiveBatches((current) => ({
                              ...current,
                              [item.id]: { ...current[item.id], expiryDate: event.target.value },
                            }))
                          }
                        />
                      </Field>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Modal>
    </>
  );
}
