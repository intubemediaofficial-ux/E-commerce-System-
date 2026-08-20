'use client';

import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { post } from '@/lib/api';
import { Card, ErrorState, PageHeader } from '@/components/ui';

const TEMPLATE =
  'sku,warehouseCode,quantity,unitCost,batchNumber,expiryDate\nING-PATTY,MAIN-JAI,25,50,OPEN-A,2026-12-31';

interface ImportResult {
  applied: number;
  errors: { row: number; message: string }[];
}

/**
 * Opening stock is imported through the inventory service, so every imported
 * row produces a ledger entry rather than writing stock directly.
 */
export default function OpeningStockImportPage() {
  const [csv, setCsv] = useState(TEMPLATE);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const run = useMutation({
    mutationFn: async () => post<ImportResult>('/api/inventory/opening-stock/import', { csv }),
    onSuccess: (data) => {
      setResult(data);
      setError(null);
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Opening stock import"
        subtitle="Bulk-load starting quantities with batch and expiry data"
      />

      <Card className="max-w-3xl">
        <p className="text-sm text-slate-500">
          Columns: sku, warehouseCode, quantity, unitCost, batchNumber, expiryDate. Batch columns are
          only used for products that track batches.
        </p>
        <textarea
          className="input mt-3 font-mono text-xs"
          rows={12}
          value={csv}
          onChange={(event) => setCsv(event.target.value)}
        />
        <button
          type="button"
          className="btn-primary mt-3"
          disabled={run.isPending}
          onClick={() => run.mutate()}
        >
          {run.isPending ? 'Importing…' : 'Import opening stock'}
        </button>

        {error ? (
          <div className="mt-3">
            <ErrorState error={error} />
          </div>
        ) : null}

        {result ? (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium text-slate-700">{result.applied} rows applied</p>
            {result.errors.length > 0 ? (
              <ul className="mt-2 list-inside list-disc text-rose-600">
                {result.errors.map((row) => (
                  <li key={`${row.row}-${row.message}`}>
                    Row {row.row}: {row.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>
    </>
  );
}
