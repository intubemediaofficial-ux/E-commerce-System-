'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useWarehouseOptions } from '@/hooks/useOptions';
import { ProductPicker } from '@/components/ProductPicker';
import { Card, EmptyState, ErrorState, Field, PageHeader } from '@/components/ui';

interface DraftItem {
  productId: string;
  name: string;
  quantity: string;
  useRecipe: boolean;
}

interface ConsumptionResult {
  totalCost: string;
  lines: { productId: string; quantity: string; cost: string }[];
}

export default function ConsumptionPage() {
  const { can } = useAuth();
  const { options: warehouses } = useWarehouseOptions();
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [result, setResult] = useState<ConsumptionResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const submit = useMutation({
    mutationFn: async () =>
      post<ConsumptionResult>(
        '/api/restaurant/consumption',
        {
          warehouseId,
          notes: notes || undefined,
          items: items.map((item) => ({
            productId: item.productId,
            quantity: Number(item.quantity),
            useRecipe: item.useRecipe,
          })),
        },
        crypto.randomUUID(),
      ),
    onSuccess: (data) => {
      setResult(data);
      setItems([]);
      setNotes('');
      setError(null);
    },
    onError: setError,
  });

  if (!can('restaurant.consumption.record')) {
    return (
      <>
        <PageHeader title="Manual consumption" />
        <Card>
          <EmptyState message="You do not have permission to record consumption." />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Manual consumption"
        subtitle="Record kitchen usage directly, optionally expanding recipes into ingredients"
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      <Card className="max-w-3xl">
        <Field label="Kitchen warehouse">
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

        <div className="mt-4">
          <span className="label">Add product</span>
          <ProductPicker
            onSelect={(product) =>
              setItems((current) =>
                current.some((item) => item.productId === product.id)
                  ? current
                  : [
                      ...current,
                      { productId: product.id, name: product.name, quantity: '1', useRecipe: false },
                    ],
              )
            }
          />
        </div>

        <ul className="mt-3 space-y-2">
          {items.map((item, index) => (
            <li
              key={item.productId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"
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
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={item.useRecipe}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((row, i) =>
                        i === index ? { ...row, useRecipe: event.target.checked } : row,
                      ),
                    )
                  }
                />
                Expand recipe
              </label>
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

        <button
          type="button"
          className="btn-primary mt-3"
          disabled={submit.isPending || !warehouseId || items.length === 0}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? 'Recording…' : 'Record consumption'}
        </button>

        {result ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-700">
              Consumed {result.lines.length} ingredient lines · cost {money(result.totalCost)}
            </p>
            <ul className="mt-2 space-y-1 text-slate-600">
              {result.lines.map((line) => (
                <li key={`${line.productId}-${line.quantity}`}>
                  {qty(line.quantity)} units · {money(line.cost)}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>
    </>
  );
}
