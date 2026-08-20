'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { get, post } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { useList, useListState } from '@/hooks/useList';
import { ProductPicker } from '@/components/ProductPicker';
import { Toolbar } from '@/components/Toolbar';
import {
  Badge,
  DataTable,
  ErrorState,
  Field,
  Modal,
  PageHeader,
  Pagination,
  Spinner,
} from '@/components/ui';

interface RecipeRow {
  id: string;
  name: string;
  yieldQuantity: string;
  status: string;
  product: { id: string; name: string; sku: string };
  items: {
    id: string;
    quantity: string;
    wastagePercentage: string;
    ingredientProduct: { id: string; name: string; sku: string };
  }[];
}

interface RecipeCost {
  totalCost: string;
  costPerUnit: string;
  items: { productId: string; productName: string; quantity: string; cost: string }[];
}

interface DraftIngredient {
  ingredientProductId: string;
  name: string;
  quantity: string;
  wastagePercentage: string;
}

export default function RecipesPage() {
  const { can } = useAuth();
  const state = useListState();
  const list = useList<RecipeRow>('/api/restaurant/recipes', state);
  const queryClient = useQueryClient();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [product, setProduct] = useState<{ id: string; name: string } | null>(null);
  const [yieldQuantity, setYieldQuantity] = useState('1');
  const [ingredients, setIngredients] = useState<DraftIngredient[]>([]);
  const [costRecipeId, setCostRecipeId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const cost = useQuery({
    queryKey: ['/api/restaurant/recipes', costRecipeId, 'cost'],
    queryFn: async () =>
      (await get<RecipeCost>(`/api/restaurant/recipes/${costRecipeId}/cost`)).data,
    enabled: Boolean(costRecipeId),
  });

  const create = useMutation({
    mutationFn: async () =>
      post('/api/restaurant/recipes', {
        productId: product?.id,
        name,
        yieldQuantity: Number(yieldQuantity),
        items: ingredients.map((item) => ({
          ingredientProductId: item.ingredientProductId,
          quantity: Number(item.quantity),
          wastagePercentage: Number(item.wastagePercentage || 0),
        })),
      }),
    onSuccess: () => {
      setOpen(false);
      setIngredients([]);
      setName('');
      setProduct(null);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['/api/restaurant/recipes'] });
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Recipes"
        subtitle="Bills of materials that drive kitchen consumption and food cost"
        actions={
          can('recipe.manage') ? (
            <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
              New recipe
            </button>
          ) : null
        }
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

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
            <DataTable<RecipeRow>
              rows={list.rows}
              emptyMessage="No recipes yet."
              columns={[
                { header: 'Recipe', cell: (row) => row.name },
                { header: 'Sells as', cell: (row) => `${row.product.name} (${row.product.sku})` },
                { header: 'Yield', align: 'right', cell: (row) => qty(row.yieldQuantity) },
                {
                  header: 'Ingredients',
                  cell: (row) => (
                    <ul className="space-y-0.5 text-xs text-slate-500">
                      {row.items.map((item) => (
                        <li key={item.id}>
                          {item.ingredientProduct.name}: {qty(item.quantity)}
                          {Number(item.wastagePercentage) > 0
                            ? ` (+${item.wastagePercentage}% waste)`
                            : ''}
                        </li>
                      ))}
                    </ul>
                  ),
                },
                { header: 'Status', cell: (row) => <Badge value={row.status} /> },
                {
                  header: 'Actions',
                  align: 'right',
                  cell: (row) => (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setCostRecipeId(row.id)}
                    >
                      Costing
                    </button>
                  ),
                },
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

      <Modal
        open={open}
        title="New recipe"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={create.isPending || !product || !name || ingredients.length === 0}
              onClick={() => create.mutate()}
            >
              {create.isPending ? 'Saving…' : 'Save recipe'}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Recipe name">
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Yield quantity">
            <input
              className="input"
              type="number"
              step="any"
              min="0"
              value={yieldQuantity}
              onChange={(event) => setYieldQuantity(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-3">
          <span className="label">Menu product</span>
          {product ? (
            <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
              {product.name}
              <button
                type="button"
                className="text-xs text-rose-600 hover:underline"
                onClick={() => setProduct(null)}
              >
                Change
              </button>
            </div>
          ) : (
            <ProductPicker onSelect={(selected) => setProduct({ id: selected.id, name: selected.name })} />
          )}
        </div>

        <div className="mt-4">
          <span className="label">Add ingredient</span>
          <ProductPicker
            placeholder="Search ingredient or raw material…"
            onSelect={(selected) =>
              setIngredients((current) =>
                current.some((item) => item.ingredientProductId === selected.id)
                  ? current
                  : [
                      ...current,
                      {
                        ingredientProductId: selected.id,
                        name: selected.name,
                        quantity: '1',
                        wastagePercentage: '0',
                      },
                    ],
              )
            }
          />
        </div>

        <ul className="mt-3 space-y-2">
          {ingredients.map((item, index) => (
            <li
              key={item.ingredientProductId}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3"
            >
              <span className="flex-1 text-sm">{item.name}</span>
              <input
                className="input max-w-[110px]"
                type="number"
                step="any"
                min="0"
                value={item.quantity}
                onChange={(event) =>
                  setIngredients((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, quantity: event.target.value } : row,
                    ),
                  )
                }
              />
              <input
                className="input max-w-[110px]"
                type="number"
                step="any"
                min="0"
                placeholder="waste %"
                value={item.wastagePercentage}
                onChange={(event) =>
                  setIngredients((current) =>
                    current.map((row, i) =>
                      i === index ? { ...row, wastagePercentage: event.target.value } : row,
                    ),
                  )
                }
              />
              <button
                type="button"
                className="text-xs text-rose-600 hover:underline"
                onClick={() =>
                  setIngredients((current) => current.filter((_, i) => i !== index))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal open={Boolean(costRecipeId)} title="Recipe costing" onClose={() => setCostRecipeId(null)}>
        {cost.isPending ? (
          <Spinner />
        ) : cost.error ? (
          <ErrorState error={cost.error} />
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="card p-3">
                <p className="text-xs uppercase text-slate-500">Total cost</p>
                <p className="text-lg font-semibold">{money(cost.data?.totalCost)}</p>
              </div>
              <div className="card p-3">
                <p className="text-xs uppercase text-slate-500">Cost per unit</p>
                <p className="text-lg font-semibold">{money(cost.data?.costPerUnit)}</p>
              </div>
            </div>
            <ul className="mt-4 divide-y divide-slate-100 text-sm">
              {(cost.data?.items ?? []).map((line) => (
                <li key={line.productId} className="flex items-center justify-between py-2">
                  <span>{line.productName}</span>
                  <span className="text-slate-500">
                    {qty(line.quantity)} · {money(line.cost)}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Modal>
    </>
  );
}
