'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { DataTable, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';

interface EcommerceDashboard {
  totalOrders: number;
  pendingOrders: number;
  todaySales: string;
  todayOrders: number;
  reservedQuantity: string;
  lowStockCount: number;
  outOfStockCount: number;
  topSellingProducts: { product: string; sku: string; quantity: string; revenue: string }[];
}

export default function EcommerceDashboardPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['/api/dashboard/ecommerce'],
    queryFn: async () => (await get<EcommerceDashboard>('/api/dashboard/ecommerce')).data,
  });

  if (isPending) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  return (
    <>
      <PageHeader title="E-commerce dashboard" subtitle="Orders, reservations and stock coverage" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total orders" value={String(data.totalOrders)} />
        <StatCard
          label="Open orders"
          value={String(data.pendingOrders)}
          hint="Created, confirmed, reserved or packed"
        />
        <StatCard
          label="Today's sales"
          value={money(data.todaySales)}
          hint={`${data.todayOrders} orders`}
        />
        <StatCard label="Reserved units" value={qty(data.reservedQuantity)} />
        <StatCard
          label="Low stock lines"
          value={String(data.lowStockCount)}
          tone={data.lowStockCount > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Out of stock lines"
          value={String(data.outOfStockCount)}
          tone={data.outOfStockCount > 0 ? 'danger' : 'success'}
        />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Top selling products (30 days)
      </h2>
      <div className="card mt-2">
        <DataTable
          rows={data.topSellingProducts.map((row, index) => ({ id: String(index), ...row }))}
          emptyMessage="No sales recorded yet."
          columns={[
            { header: 'Product', cell: (row) => row.product },
            { header: 'SKU', cell: (row) => row.sku },
            { header: 'Units', align: 'right', cell: (row) => qty(row.quantity) },
            { header: 'Revenue', align: 'right', cell: (row) => money(row.revenue) },
          ]}
        />
      </div>
    </>
  );
}
