'use client';

import { useState } from 'react';
import { get } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { Card, DataTable, ErrorState, Field, PageHeader } from '@/components/ui';
import type { Product } from '@/lib/types';

interface LookupResult {
  product: Product;
  variant: { id: string; name: string; sku: string } | null;
}

/**
 * Barcode/SKU scan surface: hardware scanners type the code and submit, so the
 * form only needs a single always-focused input.
 */
export default function ScanLookupPage() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<LookupResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setResult(null);
    try {
      const response = await get<LookupResult>('/api/products/lookup', { code: code.trim() });
      setResult(response.data);
    } catch (caught) {
      setError(caught);
    } finally {
      setCode('');
    }
  };

  const stock = result?.product.stock ?? [];

  return (
    <>
      <PageHeader title="Scan lookup" subtitle="Resolve a barcode or SKU to a product and its stock" />

      <Card className="max-w-xl">
        <form onSubmit={submit}>
          <Field label="Barcode or SKU">
            <input
              className="input"
              autoFocus
              value={code}
              placeholder="Scan or type a code and press Enter"
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <button className="btn-primary mt-3" type="submit">
            Look up
          </button>
        </form>
      </Card>

      {error ? (
        <div className="mt-4 max-w-xl">
          <ErrorState error={error} />
        </div>
      ) : null}

      {result ? (
        <div className="mt-6 space-y-4">
          <Card>
            <h2 className="text-base font-semibold text-slate-900">{result.product.name}</h2>
            <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-slate-500">SKU</dt>
                <dd className="font-medium">{result.variant?.sku ?? result.product.sku}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Variant</dt>
                <dd className="font-medium">{result.variant?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Selling price</dt>
                <dd className="font-medium">{money(result.product.sellingPrice)}</dd>
              </div>
            </dl>
          </Card>

          <Card className="p-0">
            <DataTable
              rows={stock.map((row) => ({ id: row.warehouseId, ...row }))}
              emptyMessage="No stock rows for this item yet."
              columns={[
                { header: 'Warehouse', cell: (row) => row.warehouse?.name ?? row.warehouseId },
                { header: 'On hand', align: 'right', cell: (row) => qty(row.quantity) },
                { header: 'Reserved', align: 'right', cell: (row) => qty(row.reservedQuantity) },
              ]}
            />
          </Card>
        </div>
      ) : null}
    </>
  );
}
