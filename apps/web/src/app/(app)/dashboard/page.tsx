'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { get } from '@/lib/api';
import { dateOnly, dateTime, money, qty, titleCase } from '@/lib/format';
import { Card, DataTable, ErrorState, PageHeader, Spinner, StatCard } from '@/components/ui';

interface LowStockItem {
  productId: string;
  product: string;
  sku: string;
  warehouse: string;
  quantity: string;
  reserved: string;
  reorderLevel: string;
}

interface ExpiringBatch {
  id: string;
  batchNumber: string;
  product: string;
  sku: string;
  warehouse: string;
  quantity: string;
  expiryDate: string | null;
}

interface Movement {
  id: string;
  createdAt: string;
  transactionType: string;
  quantityChange: string;
  product: string;
  sku: string;
  warehouse: string;
  performer: string | null;
}

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
  lowStockItems: LowStockItem[];
  expiringBatches: ExpiringBatch[];
  recentMovements: Movement[];
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

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <p className="label mb-0">Needs reordering</p>
            <Link className="text-sm font-medium text-brand-700 hover:underline" href="/inventory">
              All stock
            </Link>
          </div>
          <DataTable<LowStockItem>
            rows={data.lowStockItems}
            rowKey={(row, index) => `${row.productId}-${index}`}
            emptyMessage="Every product is above its reorder level."
            columns={[
              {
                header: 'Product',
                cell: (row) => (
                  <Link className="font-medium text-brand-700 hover:underline" href={`/products/${row.productId}`}>
                    {row.product}
                  </Link>
                ),
              },
              { header: 'Warehouse', cell: (row) => row.warehouse },
              { header: 'On hand', align: 'right', cell: (row) => qty(row.quantity) },
              { header: 'Reorder at', align: 'right', cell: (row) => qty(row.reorderLevel) },
            ]}
          />
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <p className="label mb-0">Expiring within 30 days</p>
            <Link
              className="text-sm font-medium text-brand-700 hover:underline"
              href="/inventory/batches"
            >
              All batches
            </Link>
          </div>
          <DataTable<ExpiringBatch>
            rows={data.expiringBatches}
            emptyMessage="No batch expires in the next 30 days."
            columns={[
              { header: 'Product', cell: (row) => row.product },
              { header: 'Batch', cell: (row) => <span className="font-mono text-xs">{row.batchNumber}</span> },
              { header: 'Expires', cell: (row) => dateOnly(row.expiryDate) },
              { header: 'Quantity', align: 'right', cell: (row) => qty(row.quantity) },
            ]}
          />
        </Card>
      </div>

      <Card className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="label mb-0">Latest stock movements</p>
          <Link
            className="text-sm font-medium text-brand-700 hover:underline"
            href="/inventory/ledger"
          >
            Full ledger
          </Link>
        </div>
        <DataTable<Movement>
          rows={data.recentMovements}
          emptyMessage="No inventory movement recorded yet."
          columns={[
            { header: 'When', cell: (row) => dateTime(row.createdAt) },
            { header: 'Type', cell: (row) => titleCase(row.transactionType) },
            { header: 'Product', cell: (row) => row.product },
            { header: 'Warehouse', cell: (row) => row.warehouse },
            {
              header: 'Change',
              align: 'right',
              cell: (row) => (
                <span
                  className={
                    Number(row.quantityChange) < 0
                      ? 'font-semibold text-rose-600'
                      : 'font-semibold text-emerald-600'
                  }
                >
                  {Number(row.quantityChange) > 0 ? '+' : ''}
                  {qty(row.quantityChange)}
                </span>
              ),
            },
            { header: 'By', cell: (row) => row.performer ?? 'System' },
          ]}
        />
      </Card>

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
