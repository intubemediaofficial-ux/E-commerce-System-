'use client';

import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { post, put } from '@/lib/api';
import { ImageUploader } from '@/components/ImageUploader';
import { Card, ErrorState, Field } from '@/components/ui';
import { FieldErrors, fieldErrorsFromApi, requiredNumber, requiredText } from '@/lib/forms';
import type { Product } from '@/lib/types';

interface FormState {
  name: string;
  purchasePrice: string;
  warehouseName: string;
  stockDate: string;
  currentStock: string;
  imageUrl: string | null;
}

const FIELD_NAMES = ['name', 'purchasePrice', 'warehouseName', 'stockDate', 'currentStock'];

/** `yyyy-mm-dd` in local time, which is what a date input expects. */
function dateInputValue(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function initialState(product: Product | null): FormState {
  if (!product) {
    return {
      name: '',
      purchasePrice: '',
      warehouseName: '',
      stockDate: dateInputValue(new Date()),
      currentStock: '',
      imageUrl: null,
    };
  }
  return {
    name: product.name,
    purchasePrice: product.purchasePrice,
    warehouseName: product.warehouseName ?? '',
    stockDate: product.stockDate ? dateInputValue(product.stockDate) : dateInputValue(new Date()),
    currentStock: product.currentStock ?? '0',
    imageUrl: product.imageUrl ?? null,
  };
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  const name = requiredText(form.name, 'Product title');
  if (name) errors.name = name;
  const price = requiredNumber(form.purchasePrice, 'Cost price');
  if (price) errors.purchasePrice = price;
  const warehouse = requiredText(form.warehouseName, 'Warehouse / shop name');
  if (warehouse) errors.warehouseName = warehouse;
  if (!form.stockDate) errors.stockDate = 'Date is required.';
  const stock = requiredNumber(form.currentStock, 'Current stock');
  if (stock) errors.currentStock = stock;
  return errors;
}

/** Add/edit form holding the only six fields a product carries. */
export function ProductForm({ product }: { product?: Product | null }) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(() => initialState(product ?? null));
  const [error, setError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const update = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setFieldErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key];
      return next;
    });
  };

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const payload = {
        name: form.name.trim(),
        purchasePrice: Number(form.purchasePrice),
        warehouseName: form.warehouseName.trim(),
        stockDate: form.stockDate,
        currentStock: Number(form.currentStock),
        imageUrl: form.imageUrl || null,
      };
      if (product) await put(`/api/products/${product.id}`, payload);
      else await post('/api/products', payload);
    },
    onSuccess: () => {
      router.push('/products');
      router.refresh();
    },
    onError: (err: unknown) => {
      setFieldErrors(fieldErrorsFromApi(err, FIELD_NAMES));
      setError(err);
    },
  });

  const submit = () => {
    const errors = validate(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setError(new Error('Please fix the highlighted fields before saving.'));
      return;
    }
    setError(null);
    save.mutate();
  };

  return (
    <Card className="max-w-2xl p-4">
      <ImageUploader value={form.imageUrl} onChange={(url) => update({ imageUrl: url })} />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Product title" required error={fieldErrors.name}>
            <input
              className="input"
              value={form.name}
              placeholder="10 Meter Anti Slip Tape"
              onChange={(event) => update({ name: event.target.value })}
            />
          </Field>
        </div>
        <Field label="Cost price (₹)" required error={fieldErrors.purchasePrice}>
          <input
            className="input"
            type="number"
            step="any"
            min="0"
            value={form.purchasePrice}
            onChange={(event) => update({ purchasePrice: event.target.value })}
          />
        </Field>
        <Field label="Warehouse / shop name" required error={fieldErrors.warehouseName}>
          <input
            className="input"
            value={form.warehouseName}
            placeholder="RK Traders"
            onChange={(event) => update({ warehouseName: event.target.value })}
          />
        </Field>
        <Field label="Date" required error={fieldErrors.stockDate}>
          <input
            className="input"
            type="date"
            value={form.stockDate}
            onChange={(event) => update({ stockDate: event.target.value })}
          />
        </Field>
        <Field
          label="Inventory / current stock (PCS)"
          required
          hint="Units you physically have right now"
          error={fieldErrors.currentStock}
        >
          <input
            className="input"
            type="number"
            step="any"
            min="0"
            value={form.currentStock}
            onChange={(event) => update({ currentStock: event.target.value })}
          />
        </Field>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary" disabled={save.isPending} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save product'}
        </button>
        <button type="button" className="btn-secondary" onClick={() => router.push('/products')}>
          Cancel
        </button>
      </div>
    </Card>
  );
}
