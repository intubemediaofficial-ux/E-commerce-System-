'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { get } from '@/lib/api';
import { dateOnly, money, qty } from '@/lib/format';
import { ProductThumb } from '@/components/ProductThumb';
import { DataTable, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';
import type { Product } from '@/lib/types';

interface DashboardSummary {
  totalProducts: number;
  totalStockUnits: string;
  totalPurchaseValue: string;
  recentProducts: Product[];
}

export default function DashboardPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['/api/dashboard/summary'],
    queryFn: async () => (await get<DashboardSummary>('/api/dashboard/summary')).data,
  });

  if (isPending) return <Spinner label="Loading dashboard" />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Dashboard"
        subtitle="Products and current stock"
        actions={
          <Link className="btn-primary" href="/products/new">
            + Add Product
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total products" value={String(data.totalProducts)} />
        <StatCard label="Total current stock units" value={qty(data.totalStockUnits)} />
        <StatCard
          label="Total purchase value"
          value={money(data.totalPurchaseValue)}
          tone="success"
        />
      </div>

      <div className="card">
        <div className="border-b border-slate-200 px-3 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Recently added products</h2>
        </div>
        <DataTable<Product>
          rows={data.recentProducts}
          emptyMessage="No products yet."
          columns={[
            { header: 'Image', cell: (row) => <ProductThumb product={row} /> },
            {
              header: 'Product title',
              cell: (row) => <span className="font-medium text-slate-800">{row.name}</span>,
            },
            { header: 'Cost price', cell: (row) => money(row.purchasePrice), align: 'right' },
            { header: 'Warehouse / shop', cell: (row) => row.warehouseName ?? '—' },
            { header: 'Date', cell: (row) => dateOnly(row.stockDate) },
            {
              header: 'Current stock',
              cell: (row) => `${qty(row.currentStock)} PCS`,
              align: 'right',
            },
          ]}
        />
      </div>
    </div>
  );
}
