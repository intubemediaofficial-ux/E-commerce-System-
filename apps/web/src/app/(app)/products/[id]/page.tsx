'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { assetUrl, get, post, put } from '@/lib/api';
import { dateOnly, money, qty, titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { ImageUploader } from '@/components/ImageUploader';
import { ProductFormModal } from '@/components/ProductFormModal';
import {
  Badge,
  Card,
  DataTable,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui';
import type { ProductDetail, ProductVariant } from '@/lib/types';

const EMPTY_VARIANT = { name: '', sku: '', barcode: '', price: '', weight: '' };

export default function ProductDetailPage() {
  const params = useParams<{ id: string }>();
  const productId = params.id;
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const queryKey = ['/api/products', productId];

  const [variantOpen, setVariantOpen] = useState(false);
  const [variantForm, setVariantForm] = useState(EMPTY_VARIANT);
  const [editingVariant, setEditingVariant] = useState<ProductVariant | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const detail = useQuery({
    queryKey,
    queryFn: async () => (await get<ProductDetail>(`/api/products/${productId}`)).data,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey });
  };

  const savePhoto = useMutation({
    mutationFn: async (url: string | null) => put(`/api/products/${productId}`, { imageUrl: url }),
    onSuccess: invalidate,
    onError: setError,
  });

  const saveVariant = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload: Record<string, unknown> = {
        name: variantForm.name,
        sku: variantForm.sku,
        barcode: variantForm.barcode || null,
        price: variantForm.price ? Number(variantForm.price) : null,
        weight: variantForm.weight ? Number(variantForm.weight) : null,
      };
      if (editingVariant) await put(`/api/products/variants/${editingVariant.id}`, payload);
      else await post(`/api/products/${productId}/variants`, { ...payload, attributes: {} });
    },
    onSuccess: () => {
      setVariantOpen(false);
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  if (detail.isPending) return <Spinner label="Loading product" />;
  if (detail.error) return <ErrorState error={detail.error} />;

  const product = detail.data;
  if (!product) return <ErrorState error={new Error('Product not found.')} />;

  const stock = product.stock ?? [];
  const onHand = stock.reduce((total, row) => total + Number(row.quantity), 0);
  const reserved = stock.reduce((total, row) => total + Number(row.reservedQuantity), 0);
  const photo = assetUrl(product.imageUrl);

  return (
    <>
      <PageHeader
        title={product.name}
        subtitle={`${product.sku} · ${titleCase(product.productType)}`}
        actions={
          <>
            <Link className="btn-secondary" href="/products">
              Back to products
            </Link>
            <Link className="btn-secondary" href="/products/scan">
              Scan station
            </Link>
            {can('product.update') ? (
              <button type="button" className="btn-primary" onClick={() => setEditOpen(true)}>
                Edit details
              </button>
            ) : null}
          </>
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="On hand" value={qty(onHand)} hint={product.unit?.name} />
        <StatCard label="Reserved" value={qty(reserved)} tone={reserved > 0 ? 'warning' : 'default'} />
        <StatCard
          label="Available"
          value={qty(onHand - reserved)}
          tone={onHand - reserved <= Number(product.reorderLevel) ? 'danger' : 'success'}
          hint={`Reorder at ${qty(product.reorderLevel)}`}
        />
        <StatCard label="Stock value" value={money(onHand * Number(product.purchasePrice))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <div className="flex items-start gap-3">
            <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt={product.name} className="h-full w-full object-cover" />
              ) : (
                <span className="text-xs text-slate-400">No photo</span>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <Badge value={product.status} />
              <p className="text-sm text-slate-600">
                {product.category?.name ?? 'Uncategorised'} · {product.brand?.name ?? 'No brand'}
              </p>
              <p className="font-mono text-xs text-slate-500">
                Barcode: {product.barcode ?? '—'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {product.trackBatches ? <span className="chip">Batch tracked</span> : null}
                {product.isPerishable ? <span className="chip">Perishable · FEFO</span> : null}
              </div>
            </div>
          </div>

          {product.description ? (
            <p className="mt-3 text-sm text-slate-600">{product.description}</p>
          ) : null}

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="surface-muted">
              <dt className="text-xs text-slate-500">Purchase price</dt>
              <dd className="font-semibold text-slate-800">{money(product.purchasePrice)}</dd>
            </div>
            <div className="surface-muted">
              <dt className="text-xs text-slate-500">Selling price</dt>
              <dd className="font-semibold text-slate-800">{money(product.sellingPrice)}</dd>
            </div>
            <div className="surface-muted">
              <dt className="text-xs text-slate-500">Tax rate</dt>
              <dd className="font-semibold text-slate-800">{qty(product.taxRate)}%</dd>
            </div>
            <div className="surface-muted">
              <dt className="text-xs text-slate-500">Minimum level</dt>
              <dd className="font-semibold text-slate-800">{qty(product.minimumStockLevel)}</dd>
            </div>
          </dl>

          {can('product.update') ? (
            <div className="mt-4 border-t border-slate-200 pt-4">
              <ImageUploader
                value={product.imageUrl ?? null}
                onChange={(url) => savePhoto.mutate(url)}
              />
            </div>
          ) : null}
        </Card>

        <Card className="lg:col-span-2">
          <p className="label">Stock by warehouse</p>
          <DataTable
            rows={stock}
            rowKey={(row) => row.warehouseId}
            emptyMessage="No stock recorded for this product yet."
            columns={[
              { header: 'Warehouse', cell: (row) => row.warehouse?.name ?? row.warehouseId },
              { header: 'On hand', align: 'right', cell: (row) => qty(row.quantity) },
              { header: 'Reserved', align: 'right', cell: (row) => qty(row.reservedQuantity) },
              {
                header: 'Available',
                align: 'right',
                cell: (row) => qty(Number(row.quantity) - Number(row.reservedQuantity)),
              },
            ]}
          />

          {product.trackBatches ? (
            <div className="mt-6">
              <p className="label">Batches</p>
              <DataTable
                rows={product.batches ?? []}
                emptyMessage="No open batches."
                columns={[
                  { header: 'Batch', cell: (row) => row.batchNumber },
                  { header: 'Manufactured', cell: (row) => dateOnly(row.manufacturingDate) },
                  { header: 'Expires', cell: (row) => dateOnly(row.expiryDate) },
                  { header: 'Quantity', align: 'right', cell: (row) => qty(row.quantity) },
                  { header: 'Unit cost', align: 'right', cell: (row) => money(row.unitCost) },
                ]}
              />
            </div>
          ) : null}

          <div className="mt-6 flex items-center justify-between">
            <p className="label mb-0">Variants</p>
            {can('product.update') ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setEditingVariant(null);
                  setVariantForm(EMPTY_VARIANT);
                  setVariantOpen(true);
                }}
              >
                Add variant
              </button>
            ) : null}
          </div>
          <DataTable
            rows={product.variants ?? []}
            emptyMessage="No variants configured."
            columns={[
              { header: 'Name', cell: (row) => row.name },
              { header: 'SKU', cell: (row) => <span className="font-mono text-xs">{row.sku}</span> },
              { header: 'Barcode', cell: (row) => row.barcode ?? '—' },
              { header: 'Price', align: 'right', cell: (row) => money(row.price) },
              {
                header: '',
                align: 'right',
                cell: (row) =>
                  can('product.update') ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => {
                        setEditingVariant(row);
                        setVariantForm({
                          name: row.name,
                          sku: row.sku,
                          barcode: row.barcode ?? '',
                          price: row.price ?? '',
                          weight: row.weight ?? '',
                        });
                        setVariantOpen(true);
                      }}
                    >
                      Edit
                    </button>
                  ) : null,
              },
            ]}
          />

          {(product.recipes ?? []).length > 0 ? (
            <div className="mt-6">
              <p className="label">Recipes producing this product</p>
              <DataTable
                rows={product.recipes ?? []}
                emptyMessage="No recipes."
                columns={[
                  { header: 'Recipe', cell: (row) => row.name },
                  { header: 'Yield', align: 'right', cell: (row) => qty(row.yieldQuantity) },
                  { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                ]}
              />
            </div>
          ) : null}
        </Card>
      </div>

      <ProductFormModal
        open={editOpen}
        product={product}
        onClose={() => setEditOpen(false)}
        onSaved={invalidate}
      />

      <Modal
        open={variantOpen}
        title={editingVariant ? 'Edit variant' : 'Add variant'}
        onClose={() => setVariantOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setVariantOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={saveVariant.isPending}
              onClick={() => saveVariant.mutate()}
            >
              {saveVariant.isPending ? 'Saving…' : 'Save variant'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className="input"
              value={variantForm.name}
              onChange={(event) => setVariantForm({ ...variantForm, name: event.target.value })}
            />
          </Field>
          <Field label="SKU">
            <input
              className="input"
              value={variantForm.sku}
              onChange={(event) => setVariantForm({ ...variantForm, sku: event.target.value })}
            />
          </Field>
          <Field label="Barcode" hint="Scan directly into this field">
            <input
              className="input"
              value={variantForm.barcode}
              onChange={(event) => setVariantForm({ ...variantForm, barcode: event.target.value })}
            />
          </Field>
          <Field label="Price">
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={variantForm.price}
              onChange={(event) => setVariantForm({ ...variantForm, price: event.target.value })}
            />
          </Field>
          <Field label="Weight">
            <input
              className="input"
              type="number"
              min="0"
              step="0.001"
              value={variantForm.weight}
              onChange={(event) => setVariantForm({ ...variantForm, weight: event.target.value })}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
