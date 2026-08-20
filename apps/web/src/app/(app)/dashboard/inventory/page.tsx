'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { money, qty } from '@/lib/format';
import {
  Badge,
  DataTable,
  ErrorState,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui';
import type { StockRow } from '@/lib/types';

interface InventorySummary {
  stockRows: number;
  totalInventoryValue: string;
  reservedQuantity: string;
  lowStockCount: number;
  outOfStockCount: number;
}

interface ExpirySummary {
  expired: number;
  expiringToday: number;
  in7Days: number;
  in15Days: number;
  in30Days: number;
}

const LOW_STOCK_QUERY = { status: 'LOW_STOCK', perPage: 10 } as const;

export default function InventoryDashboardPage() {
  const summary = useQuery({
    queryKey: ['/api/inventory/summary'],
    queryFn: async () => (await get<InventorySummary>('/api/inventory/summary')).data,
  });
  const expiry = useQuery({
    queryKey: ['/api/inventory/expiry/summary'],
    queryFn: async () => (await get<ExpirySummary>('/api/inventory/expiry/summary')).data,
  });
  const lowStock = useQuery({
    queryKey: ['/api/inventory', 'low-stock-dashboard'],
    queryFn: async () =>
      (await get<StockRow[]>('/api/inventory', LOW_STOCK_QUERY)).data,
  });

  if (summary.isPending || expiry.isPending) return <Spinner />;
  if (summary.error) return <ErrorState error={summary.error} />;

  return (
    <>
      <PageHeader title="Inventory dashboard" subtitle="Stock health, valuation and expiry risk" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard label="Stock lines" value={String(summary.data?.stockRows ?? 0)} />
        <StatCard label="Inventory value" value={money(summary.data?.totalInventoryValue)} />
        <StatCard label="Reserved units" value={qty(summary.data?.reservedQuantity)} />
        <StatCard
          label="Low stock lines"
          value={String(summary.data?.lowStockCount ?? 0)}
          tone={(summary.data?.lowStockCount ?? 0) > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Out of stock lines"
          value={String(summary.data?.outOfStockCount ?? 0)}
          tone={(summary.data?.outOfStockCount ?? 0) > 0 ? 'danger' : 'success'}
        />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Expiry risk
      </h2>
      <div className="mt-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Expired batches"
          value={String(expiry.data?.expired ?? 0)}
          tone={(expiry.data?.expired ?? 0) > 0 ? 'danger' : 'success'}
        />
        <StatCard label="Expiring today" value={String(expiry.data?.expiringToday ?? 0)} tone="warning" />
        <StatCard label="Within 7 days" value={String(expiry.data?.in7Days ?? 0)} />
        <StatCard label="Within 15 days" value={String(expiry.data?.in15Days ?? 0)} />
        <StatCard label="Within 30 days" value={String(expiry.data?.in30Days ?? 0)} />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Lines needing replenishment
      </h2>
      <div className="card mt-2">
        {lowStock.isPending ? (
          <Spinner />
        ) : (
          <DataTable<StockRow>
            rows={lowStock.data ?? []}
            emptyMessage="No products are below their reorder level."
            columns={[
              { header: 'Product', cell: (row) => row.product.name },
              { header: 'SKU', cell: (row) => row.product.sku },
              { header: 'Warehouse', cell: (row) => row.warehouse.name },
              { header: 'On hand', align: 'right', cell: (row) => qty(row.quantity) },
              { header: 'Reorder level', align: 'right', cell: (row) => qty(row.product.reorderLevel) },
              { header: 'Status', cell: (row) => <Badge value={row.stockStatus} /> },
            ]}
          />
        )}
      </div>
    </>
  );
}
