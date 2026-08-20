'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { DataTable, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';

interface RestaurantDashboard {
  kitchenStockLines: number;
  kitchenStockValue: string;
  lowIngredients: number;
  expiringBatches7Days: number;
  todayConsumptionCost: string;
  todayWastageCost: string;
  todayFoodSales: string;
  todayCompletedOrders: number;
  foodCostPercentage: string;
  topConsumedIngredients: { product: string; quantity: string; cost: string }[];
}

export default function RestaurantDashboardPage() {
  const { data, isPending, error } = useQuery({
    queryKey: ['/api/dashboard/restaurant'],
    queryFn: async () => (await get<RestaurantDashboard>('/api/dashboard/restaurant')).data,
  });

  if (isPending) return <Spinner />;
  if (error) return <ErrorState error={error} />;
  if (!data) return null;

  return (
    <>
      <PageHeader title="Restaurant dashboard" subtitle="Kitchen stock, consumption and food cost" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Kitchen stock lines" value={String(data.kitchenStockLines)} />
        <StatCard label="Kitchen stock value" value={money(data.kitchenStockValue)} />
        <StatCard
          label="Low ingredients"
          value={String(data.lowIngredients)}
          tone={data.lowIngredients > 0 ? 'warning' : 'success'}
        />
        <StatCard
          label="Batches expiring (7d)"
          value={String(data.expiringBatches7Days)}
          tone={data.expiringBatches7Days > 0 ? 'warning' : 'success'}
        />
        <StatCard label="Today's consumption" value={money(data.todayConsumptionCost)} />
        <StatCard label="Today's wastage" value={money(data.todayWastageCost)} tone="warning" />
        <StatCard
          label="Today's food sales"
          value={money(data.todayFoodSales)}
          hint={`${data.todayCompletedOrders} completed orders`}
        />
        <StatCard
          label="Food cost"
          value={`${data.foodCostPercentage}%`}
          tone={Number(data.foodCostPercentage) > 35 ? 'danger' : 'success'}
        />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Top consumed ingredients (30 days)
      </h2>
      <div className="card mt-2">
        <DataTable
          rows={data.topConsumedIngredients.map((row, index) => ({ id: String(index), ...row }))}
          emptyMessage="No ingredient consumption recorded yet."
          columns={[
            { header: 'Ingredient', cell: (row) => row.product },
            { header: 'Quantity', align: 'right', cell: (row) => qty(row.quantity) },
            { header: 'Cost', align: 'right', cell: (row) => money(row.cost) },
          ]}
        />
      </div>
    </>
  );
}
