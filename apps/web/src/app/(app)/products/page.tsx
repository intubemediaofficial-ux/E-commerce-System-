'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { assetUrl, download, post, del } from '@/lib/api';
import { money, qty, stockTotals, titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { useStockRefresh } from '@/hooks/useStockRefresh';
import { useCategoryOptions } from '@/hooks/useOptions';
import { SelectFilter, Toolbar } from '@/components/Toolbar';
import { PRODUCT_TYPES, ProductFormModal } from '@/components/ProductFormModal';
import {
  Badge,
  ConfirmButton,
  DataTable,
  ErrorState,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';
import type { Product } from '@/lib/types';

const IMPORT_TEMPLATE =
  'sku,name,unit,productType,purchasePrice,sellingPrice,reorderLevel\nSKU-001,Sample product,PCS,FINISHED_PRODUCT,10,15,5';

export default function ProductsPage() {
  const { can } = useAuth();
  const canManage = can('product.create') || can('product.update');
  const state = useListState({ status: 'ACTIVE' });
  const list = useList<Product>('/api/products', state);
  const invalidate = useStockRefresh();
  const { options: categories } = useCategoryOptions();

  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState(IMPORT_TEMPLATE);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const archive = useMutation({
    mutationFn: async (id: string) => del(`/api/products/${id}`),
    onSuccess: invalidate,
    onError: setError,
  });

  const restore = useMutation({
    mutationFn: async (id: string) => post(`/api/products/${id}/restore`),
    onSuccess: invalidate,
    onError: setError,
  });

  const runImport = useMutation({
    mutationFn: async () => post<ImportResult>('/api/products/import', { csv }),
    onSuccess: (result) => {
      setImportResult(result);
      invalidate();
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Finished goods, packaging materials and bundles"
        actions={
          <>
            <Link className="btn-secondary" href="/products/scan">
              Scan station
            </Link>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void download('/api/products/export', { format: 'csv' })}
            >
              Export CSV
            </button>
            {can('product.create') ? (
              <button type="button" className="btn-secondary" onClick={() => setImportOpen(true)}>
                Import CSV
              </button>
            ) : null}
            {can('product.create') ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                New product
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

      <div className="card">
        <Toolbar search={state.search} onSearch={state.setSearch}>
          <SelectFilter
            label="All types"
            value={state.filters.productType as string | undefined}
            options={PRODUCT_TYPES.map((type) => ({ value: type, label: titleCase(type) }))}
            onChange={(value) => state.setFilter('productType', value)}
          />
          <SelectFilter
            label="All categories"
            value={state.filters.categoryId as string | undefined}
            options={categories}
            onChange={(value) => state.setFilter('categoryId', value)}
          />
          <SelectFilter
            label="All statuses"
            value={state.filters.status as string | undefined}
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'ARCHIVED', label: 'Archived' },
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
            <DataTable<Product>
              rows={list.rows}
              emptyMessage="No products match these filters."
              columns={[
                { header: 'Photo', cell: (row) => <ProductThumb product={row} /> },
                {
                  header: 'Name',
                  cell: (row) => (
                    <Link
                      className="font-medium text-brand-700 hover:underline"
                      href={`/products/${row.id}`}
                    >
                      {row.name}
                    </Link>
                  ),
                },
                { header: 'SKU', cell: (row) => <span className="font-mono text-xs">{row.sku}</span> },
                { header: 'Type', cell: (row) => titleCase(row.productType) },
                { header: 'Unit', cell: (row) => row.unit?.code ?? '—' },
                { header: 'Category', cell: (row) => row.category?.name ?? '—' },
                { header: 'Purchase', align: 'right', cell: (row) => money(row.purchasePrice) },
                { header: 'Selling', align: 'right', cell: (row) => money(row.sellingPrice) },
                {
                  header: 'In stock',
                  align: 'right',
                  cell: (row) => <StockCell product={row} />,
                },
                { header: 'Reorder', align: 'right', cell: (row) => qty(row.reorderLevel) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                ...(canManage
                  ? [
                      {
                        header: 'Actions',
                        align: 'right' as const,
                        cell: (row: Product) => (
                          <div className="flex justify-end gap-2">
                            <Link className="btn-ghost" href={`/products/${row.id}`}>
                              View
                            </Link>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => {
                                setEditing(row);
                                setOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            {can('product.delete') && row.status !== 'ARCHIVED' ? (
                              <ConfirmButton
                                label="Archive"
                                variant="danger"
                                message="Archive this product? Historical documents keep referencing it."
                                onConfirm={() => archive.mutate(row.id)}
                              />
                            ) : null}
                            {can('product.update') && row.status === 'ARCHIVED' ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                disabled={restore.isPending}
                                onClick={() => restore.mutate(row.id)}
                              >
                                Unarchive
                              </button>
                            ) : null}
                          </div>
                        ),
                      },
                    ]
                  : []),
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

      <ProductFormModal
        open={open}
        product={editing}
        onClose={() => setOpen(false)}
        onSaved={invalidate}
      />

      <Modal
        open={importOpen}
        title="Import products from CSV"
        onClose={() => setImportOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setImportOpen(false)}>
              Close
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={runImport.isPending}
              onClick={() => runImport.mutate()}
            >
              {runImport.isPending ? 'Importing…' : 'Import'}
            </button>
          </>
        }
      >
        <p className="text-sm text-slate-500">
          Columns: sku, name, barcode, productType, unit, category, brand, purchasePrice,
          sellingPrice, taxRate, reorderLevel, trackBatches, isPerishable. Existing SKUs are updated.
        </p>
        <textarea
          className="input mt-3 font-mono text-xs"
          rows={10}
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
        />
        {importResult ? (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-700">
              Created {importResult.created} · Updated {importResult.updated}
            </p>
            {importResult.errors.length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-rose-600">
                {importResult.errors.map((row) => (
                  <li key={`${row.row}-${row.message}`}>
                    Row {row.row}: {row.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

function StockCell({ product }: { product: Product }) {
  const totals = stockTotals(product.stock);
  const low = totals.available <= Number(product.reorderLevel ?? 0);
  return (
    <span className={low ? 'font-semibold text-amber-600' : 'font-medium text-slate-700'}>
      {qty(totals.available)}
      {totals.reserved > 0 ? (
        <span className="ml-1 text-xs text-slate-400">({qty(totals.onHand)} on hand)</span>
      ) : null}
    </span>
  );
}

function ProductThumb({ product }: { product: Product }) {
  const src = assetUrl(product.imageUrl);
  if (!src) {
    return (
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase text-slate-400">
        {product.name.slice(0, 2)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={product.name}
      className="h-10 w-10 rounded-lg border border-slate-200 object-cover"
    />
  );
}

interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}
