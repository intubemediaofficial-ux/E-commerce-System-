'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { download, get } from '@/lib/api';
import { useCategoryOptions, useSupplierOptions, useWarehouseOptions } from '@/hooks/useOptions';
import { Card, DataTable, ErrorState, Field, PageHeader, Spinner } from '@/components/ui';

interface ReportPayload {
  title: string;
  columns: { header: string; key: string }[];
  rows: Record<string, string>[];
}

const REPORTS: { group: string; items: { slug: string; label: string }[] }[] = [
  {
    group: 'Inventory',
    items: [
      { slug: 'current-stock', label: 'Current stock' },
      { slug: 'stock-ledger', label: 'Stock ledger' },
      { slug: 'valuation', label: 'Inventory valuation' },
      { slug: 'low-stock', label: 'Low & out of stock' },
      { slug: 'expiry', label: 'Expiry' },
      { slug: 'stock-movement', label: 'Stock movement' },
      { slug: 'adjustments', label: 'Adjustments' },
      { slug: 'transfers', label: 'Transfers' },
      { slug: 'wastage', label: 'Wastage' },
    ],
  },
  {
    group: 'Purchasing',
    items: [
      { slug: 'purchases', label: 'Purchases' },
      { slug: 'supplier-purchases', label: 'Supplier purchases' },
      { slug: 'purchase-returns', label: 'Purchase returns' },
      { slug: 'price-history', label: 'Purchase price history' },
    ],
  },
  {
    group: 'Restaurant',
    items: [
      { slug: 'consumption', label: 'Ingredient consumption' },
      { slug: 'food-cost', label: 'Food cost' },
      { slug: 'recipe-cost', label: 'Recipe cost' },
    ],
  },
  {
    group: 'Sales & audit',
    items: [
      { slug: 'sales', label: 'E-commerce sales' },
      { slug: 'product-sales', label: 'Product sales' },
      { slug: 'audit', label: 'Audit trail' },
    ],
  },
];

export default function ReportsPage() {
  const [slug, setSlug] = useState('current-stock');
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { options: warehouses } = useWarehouseOptions();
  const { options: categories } = useCategoryOptions();
  const { options: suppliers } = useSupplierOptions();

  const params = {
    ...(warehouseId ? { warehouseId } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };

  const report = useQuery({
    queryKey: ['/api/reports', slug, params],
    queryFn: async () => (await get<ReportPayload>(`/api/reports/${slug}`, params)).data,
  });

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle="Every report is generated server-side and exportable to CSV, Excel or PDF"
        actions={
          <div className="flex gap-2">
            {(['csv', 'excel', 'pdf'] as const).map((format) => (
              <button
                key={format}
                type="button"
                className="btn-secondary"
                onClick={() => void download(`/api/reports/${slug}`, { ...params, format })}
              >
                {format.toUpperCase()}
              </button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        <Card>
          <nav className="space-y-4">
            {REPORTS.map((group) => (
              <div key={group.group}>
                <p className="label">{group.group}</p>
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <li key={item.slug}>
                      <button
                        type="button"
                        className={`w-full rounded-lg px-3 py-2 text-left text-sm transition ${
                          slug === item.slug
                            ? 'bg-brand-50 font-medium text-brand-700'
                            : 'text-slate-600 hover:bg-slate-50'
                        }`}
                        onClick={() => setSlug(item.slug)}
                      >
                        {item.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </Card>

        <div>
          <Card className="mb-4">
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Field label="Warehouse">
                <select
                  className="input"
                  value={warehouseId}
                  onChange={(event) => setWarehouseId(event.target.value)}
                >
                  <option value="">All</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.value} value={warehouse.value}>
                      {warehouse.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Category">
                <select
                  className="input"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">All</option>
                  {categories.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Supplier">
                <select
                  className="input"
                  value={supplierId}
                  onChange={(event) => setSupplierId(event.target.value)}
                >
                  <option value="">All</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.value} value={supplier.value}>
                      {supplier.label}
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

          <div className="card">
            <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
              {report.data?.title ?? 'Report'}
            </h2>
            {report.isPending ? (
              <Spinner />
            ) : report.error ? (
              <div className="p-4">
                <ErrorState error={report.error} />
              </div>
            ) : (
              <DataTable<Record<string, string>>
                rows={report.data?.rows ?? []}
                emptyMessage="No rows for these filters."
                columns={(report.data?.columns ?? []).map((column) => ({
                  header: column.header,
                  cell: (row) => row[column.key] ?? '—',
                }))}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
