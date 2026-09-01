'use client';

import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { post, put } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useBrandOptions, useCategoryOptions, useUnitOptions } from '@/hooks/useOptions';
import { ImageUploader } from '@/components/ImageUploader';
import { ErrorState, Field, Modal } from '@/components/ui';
import { FieldErrors, fieldErrorsFromApi, requiredNumber, requiredText } from '@/lib/forms';
import type { Product } from '@/lib/types';

export const PRODUCT_TYPES = [
  'FINISHED_PRODUCT',
  'RAW_MATERIAL',
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

const FIELD_NAMES = [
  'name',
  'sku',
  'barcode',
  'unitId',
  'categoryId',
  'brandId',
  'purchasePrice',
  'sellingPrice',
  'taxRate',
  'reorderLevel',
  'minimumStockLevel',
];

/** Client-side checks so the user sees the offending field before a round trip. */
function validateForm(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const set = (field: string, message: string | null) => {
    if (message) errors[field] = message;
  };

  set('name', requiredText(form.name, 'Name'));
  set('sku', requiredText(form.sku, 'SKU'));
  if (!errors.sku && !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(form.sku.trim())) {
    errors.sku = 'Please enter a valid SKU (letters, numbers, . _ / - only).';
  }
  set('unitId', form.unitId ? null : 'Unit is required.');
  set('purchasePrice', requiredNumber(form.purchasePrice, 'Purchase price'));
  set('sellingPrice', requiredNumber(form.sellingPrice, 'Selling price'));
  set('taxRate', requiredNumber(form.taxRate, 'Tax rate'));
  set('reorderLevel', requiredNumber(form.reorderLevel, 'Reorder level'));
  set('minimumStockLevel', requiredNumber(form.minimumStockLevel, 'Minimum stock level'));
  return errors;
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});
    setForm(product ? fromProduct(product) : EMPTY_FORM);
  }, [open, product]);

  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  };

  const submit = () => {
    const errors = validateForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError(new Error('Please fix the highlighted fields before saving.'));
      return;
    }
    setError(null);
    save.mutate();
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
      setFieldErrors({});
      onSaved();
      onClose();
    },
    onError: (err: unknown) => {
      setFieldErrors(fieldErrorsFromApi(err, FIELD_NAMES));
      setError(err);
    },
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
            onClick={submit}
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
        <Field label="Name" required error={fieldErrors.name}>
          <input
            className="input"
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
          />
        </Field>
        <Field label="SKU" required hint="Unique within the organization" error={fieldErrors.sku}>
          <input
            className="input"
            value={form.sku}
            onChange={(event) => update({ sku: event.target.value })}
          />
        </Field>
        <Field label="Barcode" hint="Scan directly into this field" error={fieldErrors.barcode}>
          <input
            className="input"
            value={form.barcode}
            onChange={(event) => update({ barcode: event.target.value })}
          />
        </Field>
        <Field label="Product type">
          <select
            className="input"
            value={form.productType}
            onChange={(event) => update({ productType: event.target.value })}
          >
            {PRODUCT_TYPES.map((type) => (
              <option key={type} value={type}>
                {titleCase(type)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit" required error={fieldErrors.unitId}>
          <select
            className="input"
            value={form.unitId}
            onChange={(event) => update({ unitId: event.target.value })}
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
            onChange={(event) => update({ categoryId: event.target.value })}
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
            onChange={(event) => update({ brandId: event.target.value })}
          >
            <option value="">None</option>
            {brands.map((brand) => (
              <option key={brand.value} value={brand.value}>
                {brand.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Purchase price" required error={fieldErrors.purchasePrice}>
          <input
            className="input"
            type="number"
            step="any"
            value={form.purchasePrice}
            onChange={(event) => update({ purchasePrice: event.target.value })}
          />
        </Field>
        <Field label="Selling price" required error={fieldErrors.sellingPrice}>
          <input
            className="input"
            type="number"
            step="any"
            value={form.sellingPrice}
            onChange={(event) => update({ sellingPrice: event.target.value })}
          />
        </Field>
        <Field label="Tax rate %" error={fieldErrors.taxRate}>
          <input
            className="input"
            type="number"
            step="any"
            value={form.taxRate}
            onChange={(event) => update({ taxRate: event.target.value })}
          />
        </Field>
        <Field label="Reorder level" error={fieldErrors.reorderLevel}>
          <input
            className="input"
            type="number"
            step="any"
            value={form.reorderLevel}
            onChange={(event) => update({ reorderLevel: event.target.value })}
          />
        </Field>
        <Field label="Minimum stock level" error={fieldErrors.minimumStockLevel}>
          <input
            className="input"
            type="number"
            step="any"
            value={form.minimumStockLevel}
            onChange={(event) => update({ minimumStockLevel: event.target.value })}
          />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.trackBatches}
            onChange={(event) => update({ trackBatches: event.target.checked })}
          />
          Track batches
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={form.isPerishable}
            onChange={(event) => update({ isPerishable: event.target.checked })}
          />
          Perishable (FEFO consumption)
        </label>
        <div className="sm:col-span-2">
          <Field label="Description">
            <textarea
              className="input"
              rows={3}
              value={form.description}
              onChange={(event) => update({ description: event.target.value })}
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
