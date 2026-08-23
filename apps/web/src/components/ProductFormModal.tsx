'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { post, put } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useBrandOptions, useCategoryOptions, useUnitOptions } from '@/hooks/useOptions';
import { ImageUploader } from '@/components/ImageUploader';
import { ErrorState, Field, Modal } from '@/components/ui';
import type { Product } from '@/lib/types';

export const PRODUCT_TYPES = [
  'FINISHED_PRODUCT',
  'RAW_MATERIAL',
  'INGREDIENT',
  'PACKAGING_MATERIAL',
  'SERVICE',
  'BUNDLE',
];

interface FormState {
  name: string;
  sku: string;
  barcode: string;
  productType: string;
  unitId: string;
  categoryId: string;
  brandId: string;
  purchasePrice: string;
  sellingPrice: string;
  taxRate: string;
  reorderLevel: string;
  minimumStockLevel: string;
  description: string;
  imageUrl: string | null;
  trackBatches: boolean;
  isPerishable: boolean;
}

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
  description: '',
  imageUrl: null,
  trackBatches: false,
  isPerishable: false,
};

function fromProduct(product: Product): FormState {
  return {
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
    description: product.description ?? '',
    imageUrl: product.imageUrl ?? null,
    trackBatches: product.trackBatches,
    isPerishable: product.isPerishable,
  };
}

/** Create/edit form shared by the product list and the product detail page. */
export function ProductFormModal({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { options: units } = useUnitOptions();
  const { options: categories } = useCategoryOptions();
  const { options: brands } = useBrandOptions();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setForm(product ? fromProduct(product) : EMPTY_FORM);
  }, [open, product]);

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
        trackBatches: form.trackBatches,
        isPerishable: form.isPerishable,
        barcode: form.barcode || null,
        description: form.description || null,
        imageUrl: form.imageUrl || null,
      };
      if (form.categoryId) payload.categoryId = form.categoryId;
      if (form.brandId) payload.brandId = form.brandId;

      if (product) await put(`/api/products/${product.id}`, payload);
      else await post('/api/products', payload);
    },
    onSuccess: () => {
      setError(null);
      onSaved();
      onClose();
    },
    onError: setError,
  });

  return (
    <Modal
      open={open}
      title={product ? `Edit ${product.name}` : 'New product'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
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
      <div className="mb-4">
        <ImageUploader
          value={form.imageUrl}
          onChange={(url) => setForm((current) => ({ ...current, imageUrl: url }))}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name">
          <input
            className="input"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </Field>
        <Field label="SKU" hint="Unique within the organization">
          <input
            className="input"
            value={form.sku}
            onChange={(event) => setForm({ ...form, sku: event.target.value })}
          />
        </Field>
        <Field label="Barcode" hint="Scan directly into this field">
          <input
            className="input"
            value={form.barcode}
            onChange={(event) => setForm({ ...form, barcode: event.target.value })}
          />
        </Field>
        <Field label="Product type">
          <select
            className="input"
            value={form.productType}
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
            value={form.unitId}
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
            value={form.categoryId}
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
            value={form.brandId}
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
            value={form.purchasePrice}
            onChange={(event) => setForm({ ...form, purchasePrice: event.target.value })}
          />
        </Field>
        <Field label="Selling price">
          <input
            className="input"
            type="number"
            step="any"
            value={form.sellingPrice}
            onChange={(event) => setForm({ ...form, sellingPrice: event.target.value })}
          />
        </Field>
        <Field label="Tax rate %">
          <input
            className="input"
            type="number"
            step="any"
            value={form.taxRate}
            onChange={(event) => setForm({ ...form, taxRate: event.target.value })}
          />
        </Field>
        <Field label="Reorder level">
          <input
            className="input"
            type="number"
            step="any"
            value={form.reorderLevel}
            onChange={(event) => setForm({ ...form, reorderLevel: event.target.value })}
          />
        </Field>
        <Field label="Minimum stock level">
          <input
            className="input"
            type="number"
            step="any"
            value={form.minimumStockLevel}
            onChange={(event) => setForm({ ...form, minimumStockLevel: event.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.trackBatches}
            onChange={(event) => setForm({ ...form, trackBatches: event.target.checked })}
          />
          Track batches
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.isPerishable}
            onChange={(event) => setForm({ ...form, isPerishable: event.target.checked })}
          />
          Perishable (FEFO consumption)
        </label>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>
        </div>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorState error={error} />
        </div>
      ) : null}
    </Modal>
  );
}
