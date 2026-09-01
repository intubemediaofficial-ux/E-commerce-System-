'use client';

import { dateTime, money } from '@/lib/format';
import { useList, useListState } from '@/hooks/useList';
import { Toolbar } from '@/components/Toolbar';
import { DataTable, ErrorState, PageHeader, Pagination, Spinner } from '@/components/ui';

interface CustomerRow {
  name: string;
  email: string | null;
  phone: string | null;
  orders: number;
  totalSpend: string;
  lastOrderAt: string;
}

export default function CustomersPage() {
  const state = useListState();
  const list = useList<CustomerRow>('/api/ecommerce/customers', state);

  return (
    <>
      <PageHeader title="Customers" subtitle="Buyers derived from e-commerce orders" />

      <div className="card">
        <Toolbar search={state.search} onSearch={state.setSearch} />
        {list.isLoading ? (
          <Spinner />
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : (
          <>
            <DataTable<CustomerRow>
              rows={list.rows}
              emptyMessage="No customers yet."
              columns={[
                { header: 'Customer', cell: (row) => row.name },
                { header: 'Email', cell: (row) => row.email ?? '—' },
                { header: 'Phone', cell: (row) => row.phone ?? '—' },
                { header: 'Orders', align: 'right', cell: (row) => row.orders },
                { header: 'Total spend', align: 'right', cell: (row) => money(row.totalSpend) },
                { header: 'Last order', cell: (row) => dateTime(row.lastOrderAt) },
              ]}
            />
            <Pagination
              page={list.meta.page}
              totalPages={list.meta.totalPages}
              total={list.meta.total}
              onChange={state.setPage}
            />
          </>
        )}
      </div>
    </>
  );
}
