'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { get } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';

interface AdminDashboard {
  totalProducts: number;
  totalWarehouses: number;
  totalInventoryValue: string;
  reservedQuantity: string;
  lowStockCount: number;
  outOfStockCount: number;
  todaySales: string;
  todaySalesOrders: number;
  todayPurchases: string;
  todayPurchaseOrders: number;
  todayWastageCost: string;
  todayWastageEntries: number;
  pendingPurchaseOrders: number;
  pendingTransfers: number;
  pendingAdjustments: number;
}

export default function AdminDashboardPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['/api/dashboard/admin'],
    queryFn: async () => (await get<AdminDashboard>('/api/dashboard/admin')).data,
  });

  if (isPending) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  return (
    <>
      <PageHeader
        title="Admin dashboard"
        subtitle="Company-wide inventory, sales and purchasing signals"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active products" value={String(data.totalProducts)} />
        <StatCard label="Warehouses" value={String(data.totalWarehouses)} />
        <StatCard label="Inventory value" value={money(data.totalInventoryValue)} />
        <StatCard label="Reserved units" value={qty(data.reservedQuantity)} />
        <StatCard
          label="Low stock"
          value={String(data.lowStockCount)}
          tone={data.lowStockCount > 0 ? 'warning' : 'success'}
          hint="At or below reorder level"
        />
        <StatCard
          label="Out of stock"
          value={String(data.outOfStockCount)}
          tone={data.outOfStockCount > 0 ? 'danger' : 'success'}
        />
        <StatCard
          label="Today's sales"
          value={money(data.todaySales)}
          hint={`${data.todaySalesOrders} orders`}
        />
        <StatCard
          label="Today's purchases"
          value={money(data.todayPurchases)}
          hint={`${data.todayPurchaseOrders} purchase orders`}
        />
        <StatCard
          label="Today's wastage"
          value={money(data.todayWastageCost)}
          tone={Number(data.todayWastageCost) > 0 ? 'warning' : 'default'}
          hint={`${data.todayWastageEntries} entries`}
        />
        <StatCard label="Pending purchase orders" value={String(data.pendingPurchaseOrders)} />
        <StatCard label="Pending transfers" value={String(data.pendingTransfers)} />
        <StatCard
          label="Adjustments awaiting approval"
          value={String(data.pendingAdjustments)}
          tone={data.pendingAdjustments > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link className="btn-secondary" href="/inventory">
          Review stock
        </Link>
        <Link className="btn-secondary" href="/purchase-orders">
          Purchase orders
        </Link>
        <Link className="btn-secondary" href="/inventory/adjustments">
          Adjustment approvals
        </Link>
        <Link className="btn-secondary" href="/reports">
          Reports
        </Link>
      </div>
    </>
  );
}
