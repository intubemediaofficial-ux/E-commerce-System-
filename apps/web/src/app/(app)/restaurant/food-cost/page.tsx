'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { download, get } from '@/lib/api';
import { useWarehouseOptions } from '@/hooks/useOptions';
import { Card, DataTable, ErrorState, Field, PageHeader, Spinner } from '@/components/ui';

interface ReportPayload {
  title: string;
  columns: { header: string; key: string }[];
  rows: Record<string, string>[];
}

export default function FoodCostPage() {
  const { options: warehouses } = useWarehouseOptions();
  const [warehouseId, setWarehouseId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const params = {
    ...(warehouseId ? { warehouseId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const report = useQuery({
    queryKey: ['/api/reports/food-cost', params],
    queryFn: async () => (await get<ReportPayload>('/api/reports/food-cost', params)).data,
  });

  const recipeCost = useQuery({
    queryKey: ['/api/reports/recipe-cost'],
    queryFn: async () => (await get<ReportPayload>('/api/reports/recipe-cost')).data,
  });

  return (
    <>
      <PageHeader
        title="Food cost"
        subtitle="Ingredient consumption cost against completed food sales"
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void download('/api/reports/food-cost', { ...params, format: 'excel' })}
          >
            Export Excel
          </button>
        }
      />

      <Card className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Kitchen">
            <select
              className="input"
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
            >
              <option value="">All warehouses</option>
              {warehouses.map((warehouse) => (
                <option key={warehouse.value} value={warehouse.value}>
                  {warehouse.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input
              className="input"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field label="To">
            <input
              className="input"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="card mb-4">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Food cost summary</h2>
        {report.isPending ? (
          <Spinner />
        ) : report.error ? (
          <div className="p-4">
            <ErrorState error={report.error} />
          </div>
        ) : (
          <DataTable<Record<string, string>>
            rows={report.data?.rows ?? []}
            emptyMessage="No completed orders in this period."
            columns={(report.data?.columns ?? []).map((column) => ({
              header: column.header,
              cell: (row) => row[column.key] ?? '—',
            }))}
          />
        )}
      </div>

      <div className="card">
        <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">Recipe costing</h2>
        {recipeCost.isPending ? (
          <Spinner />
        ) : recipeCost.error ? (
          <div className="p-4">
            <ErrorState error={recipeCost.error} />
          </div>
        ) : (
          <DataTable<Record<string, string>>
            rows={recipeCost.data?.rows ?? []}
            emptyMessage="No active recipes."
            columns={(recipeCost.data?.columns ?? []).map((column) => ({
              header: column.header,
              cell: (row) => row[column.key] ?? '—',
            }))}
          />
        )}
      </div>
    </>
  );
}
