'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { download, post, put, del } from '@/lib/api';
import { money, qty, titleCase } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { useBrandOptions, useCategoryOptions, useUnitOptions } from '@/hooks/useOptions';
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
import type { Product } from '@/lib/types';

const PRODUCT_TYPES = [
  'FINISHED_PRODUCT',
  'RAW_MATERIAL',
  'INGREDIENT',
  'PACKAGING_MATERIAL',
  'SERVICE',
  'BUNDLE',
];

type FormState = Record<string, string | boolean>;

const EMPTY_FORM: FormState = {
  name: '',
  sku: '',
  barcode: '',
  productType: 'FINISHED_PRODUCT',
  unitId: '',
  categoryId: '',
  brandId: '',
  purchasePrice: '0',
  sellingPrice: '0',
  taxRate: '0',
  reorderLevel: '0',
  minimumStockLevel: '0',
  trackBatches: false,
  isPerishable: false,
};

const IMPORT_TEMPLATE =
  'sku,name,unit,productType,purchasePrice,sellingPrice,reorderLevel\nSKU-001,Sample product,PCS,FINISHED_PRODUCT,10,15,5';

export default function ProductsPage() {
  const { can } = useAuth();
  const canManage = can('product.create') || can('product.update');
  const state = useListState();
  const list = useList<Product>('/api/products', state);
  const queryClient = useQueryClient();
  const { options: units } = useUnitOptions();
  const { options: categories } = useCategoryOptions();
  const { options: brands } = useBrandOptions();

  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [importOpen, setImportOpen] = useState(false);
  const [csv, setCsv] = useState(IMPORT_TEMPLATE);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['/api/products'] });
  };

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload: Record<string, unknown> = {
        name: form.name,
        sku: form.sku,
        productType: form.productType,
        unitId: form.unitId,
        purchasePrice: Number(form.purchasePrice || 0),
        sellingPrice: Number(form.sellingPrice || 0),
        taxRate: Number(form.taxRate || 0),
        reorderLevel: Number(form.reorderLevel || 0),
        minimumStockLevel: Number(form.minimumStockLevel || 0),
        trackBatches: Boolean(form.trackBatches),
        isPerishable: Boolean(form.isPerishable),
      };
      if (form.barcode) payload.barcode = form.barcode;
      if (form.categoryId) payload.categoryId = form.categoryId;
      if (form.brandId) payload.brandId = form.brandId;

      if (editing) await put(`/api/products/${editing.id}`, payload);
      else await post('/api/products', payload);
    },
    onSuccess: () => {
      setOpen(false);
      setError(null);
      invalidate();
    },
    onError: setError,
  });

  const archive = useMutation({
    mutationFn: async (id: string) => del(`/api/products/${id}`),
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

  const startEdit = (product: Product): void => {
    setEditing(product);
    setForm({
      name: product.name,
      sku: product.sku,
      barcode: product.barcode ?? '',
      productType: product.productType,
      unitId: product.unit?.id ?? '',
      categoryId: product.category?.id ?? '',
      brandId: product.brand?.id ?? '',
      purchasePrice: product.purchasePrice,
      sellingPrice: product.sellingPrice,
      taxRate: product.taxRate,
      reorderLevel: product.reorderLevel,
      minimumStockLevel: product.minimumStockLevel,
      trackBatches: product.trackBatches,
      isPerishable: product.isPerishable,
    });
    setOpen(true);
  };

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Finished goods, raw materials, ingredients, packaging and bundles"
        actions={
          <>
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
                  setForm(EMPTY_FORM);
                  setOpen(true);
                }}
              >
                New product
              </button>
            ) : null}
          </>
        }
      />

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
                { header: 'Name', cell: (row) => row.name },
                { header: 'SKU', cell: (row) => row.sku },
                { header: 'Type', cell: (row) => titleCase(row.productType) },
                { header: 'Unit', cell: (row) => row.unit?.code ?? '—' },
                { header: 'Category', cell: (row) => row.category?.name ?? '—' },
                { header: 'Purchase', align: 'right', cell: (row) => money(row.purchasePrice) },
                { header: 'Selling', align: 'right', cell: (row) => money(row.sellingPrice) },
                { header: 'Reorder', align: 'right', cell: (row) => qty(row.reorderLevel) },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                ...(canManage
                  ? [
                      {
                        header: 'Actions',
                        align: 'right' as const,
                        cell: (row: Product) => (
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => startEdit(row)}
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

      <Modal
        open={open}
        title={editing ? 'Edit product' : 'New product'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending ? 'Saving…' : 'Save product'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input
              className="input"
              value={String(form.name)}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          </Field>
          <Field label="SKU" hint="Unique within the organization">
            <input
              className="input"
              value={String(form.sku)}
              onChange={(event) => setForm({ ...form, sku: event.target.value })}
            />
          </Field>
          <Field label="Barcode">
            <input
              className="input"
              value={String(form.barcode)}
              onChange={(event) => setForm({ ...form, barcode: event.target.value })}
            />
          </Field>
          <Field label="Product type">
            <select
              className="input"
              value={String(form.productType)}
              onChange={(event) => setForm({ ...form, productType: event.target.value })}
            >
              {PRODUCT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {titleCase(type)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unit">
            <select
              className="input"
              value={String(form.unitId)}
              onChange={(event) => setForm({ ...form, unitId: event.target.value })}
            >
              <option value="">Select…</option>
              {units.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select
              className="input"
              value={String(form.categoryId)}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="">None</option>
              {categories.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Brand">
            <select
              className="input"
              value={String(form.brandId)}
              onChange={(event) => setForm({ ...form, brandId: event.target.value })}
            >
              <option value="">None</option>
              {brands.map((brand) => (
                <option key={brand.value} value={brand.value}>
                  {brand.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Purchase price">
            <input
              className="input"
              type="number"
              step="any"
              value={String(form.purchasePrice)}
              onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })}
            />
          </Field>
          <Field label="Selling price">
            <input
              className="input"
              type="number"
              step="any"
              value={String(form.sellingPrice)}
              onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })}
            />
          </Field>
          <Field label="Tax rate %">
            <input
              className="input"
              type="number"
              step="any"
              value={String(form.taxRate)}
              onChange={(event) => setForm({ ...form, taxRate: event.target.value })}
            />
          </Field>
          <Field label="Reorder level">
            <input
              className="input"
              type="number"
              step="any"
              value={String(form.reorderLevel)}
              onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })}
            />
          </Field>
          <Field label="Minimum stock level">
            <input
              className="input"
              type="number"
              step="any"
              value={String(form.minimumStockLevel)}
              onChange={(event) => setForm({ ...form, minimumStockLevel: event.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={Boolean(form.trackBatches)}
              onChange={(event) => setForm({ ...form, trackBatches: event.target.checked })}
            />
            Track batches
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={Boolean(form.isPerishable)}
              onChange={(event) => setForm({ ...form, isPerishable: event.target.checked })}
            />
            Perishable (FEFO consumption)
          </label>
        </div>
        {error ? (
          <div className="mt-3">
            <ErrorState error={error} />
          </div>
        ) : null}
      </Modal>

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

interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; message: string }[];
}
