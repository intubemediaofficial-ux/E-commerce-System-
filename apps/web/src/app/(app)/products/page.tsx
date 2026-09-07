'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { del, post } from '@/lib/api';
import { dateOnly, money, qty } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { Toolbar } from '@/components/Toolbar';
import { ProductThumb } from '@/components/ProductThumb';
import {
  ConfirmButton,
  DataTable,
  ErrorState,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';
import type { Product } from '@/lib/types';

export default function ProductsPage() {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const state = useListState({ status: 'ACTIVE' });
  const list = useList<Product>('/api/products', state);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const refresh = (): void => {
    setError(null);
    setSelected([]);
    void queryClient.invalidateQueries({ queryKey: ['/api/products'] });
    void queryClient.invalidateQueries({ queryKey: ['/api/dashboard/summary'] });
  };

  const remove = useMutation({
    mutationFn: async (id: string) => del(`/api/products/${id}`),
    onSuccess: refresh,
    onError: setError,
  });

  const removeSelected = useMutation({
    mutationFn: async (ids: string[]) => post('/api/products/bulk-delete', { ids }),
    onSuccess: refresh,
    onError: setError,
  });

  const toggle = (id: string): void =>
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  const pageIds = list.rows.map((row) => row.id);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));
  const canDelete = can('product.delete');

  return (
    <>
      <PageHeader
        title="Products"
        subtitle="Product list with current stock"
        actions={
          can('product.create') ? (
            <Link className="btn-primary" href="/products/new">
              + Add Product
            </Link>
          ) : null
        }
      />

      {error ? (
        <div className="mb-3">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="card">
        <Toolbar search={state.search} onSearch={state.setSearch}>
          {canDelete ? (
            <ConfirmButton
              label={`Delete selected${selected.length ? ` (${selected.length})` : ''}`}
              variant="danger"
              disabled={selected.length === 0 || removeSelected.isPending}
              message={`Delete ${selected.length} selected product(s)? This cannot be undone.`}
              onConfirm={() => removeSelected.mutate(selected)}
            />
          ) : null}
        </Toolbar>
        {list.isLoading ? (
          <div className="p-6">
            <Spinner label="Loading products" />
          </div>
        ) : list.error ? (
          <div className="p-4">
            <ErrorState error={list.error} />
          </div>
        ) : (
          <DataTable<Product>
            rows={list.rows}
            emptyMessage="No products yet. Use “Add Product” to create the first one."
            columns={[
              ...(canDelete
                ? [
                    {
                      header: 'Select',
                      headerCell: (
                        <input
                          type="checkbox"
                          aria-label="Select all products on this page"
                          className="h-4 w-4"
                          checked={allSelected}
                          onChange={() => setSelected(allSelected ? [] : pageIds)}
                        />
                      ),
                      cell: (row: Product) => (
                        <input
                          type="checkbox"
                          aria-label={`Select ${row.name}`}
                          className="h-4 w-4"
                          checked={selected.includes(row.id)}
                          onChange={() => toggle(row.id)}
                        />
                      ),
                    },
                  ]
                : []),
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
              {
                header: 'Actions',
                align: 'right',
                cell: (row) => (
                  <div className="flex justify-end gap-2">
                    {can('product.update') ? (
                      <Link className="btn-secondary" href={`/products/${row.id}/edit`}>
                        Edit
                      </Link>
                    ) : null}
                    {canDelete ? (
                      <ConfirmButton
                        label="Delete"
                        variant="danger"
                        message={`Delete ${row.name}?`}
                        onConfirm={() => remove.mutate(row.id)}
                      />
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
        <Pagination
          page={list.meta.page}
          totalPages={list.meta.totalPages}
          total={list.meta.total}
          onChange={state.setPage}
        />
      </div>
    </>
  );
}
