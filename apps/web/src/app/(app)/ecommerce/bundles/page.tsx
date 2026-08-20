'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { get, put } from '@/lib/api';
import { qty } from '@/lib/format';
import { useAuth } from '@/components/AuthProvider';
import { ProductPicker } from '@/components/ProductPicker';
import { Card, EmptyState, ErrorState, Field, PageHeader, Spinner } from '@/components/ui';
import type { Product } from '@/lib/types';

interface Bundle {
  id: string;
  name: string;
  items: {
    id: string;
    quantity: string;
    componentProduct: { id: string; name: string; sku: string };
  }[];
}

interface DraftItem {
  componentProductId: string;
  name: string;
  quantity: string;
}

export default function BundlesPage() {
  const { can } = useAuth();
  const canManage = can('ecommerce.bundle.manage');
  const queryClient = useQueryClient();

  const [product, setProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  const bundle = useQuery({
    queryKey: ['/api/products', product?.id, 'bundle'],
    queryFn: async () => {
      try {
        return (await get<Bundle>(`/api/products/${product?.id}/bundle`)).data;
      } catch {
        return null;
      }
    },
    enabled: Boolean(product),
  });

  useEffect(() => {
    if (!product) return;
    setSaved(false);
    setName(bundle.data?.name ?? `${product.name} bundle`);
    setItems(
      (bundle.data?.items ?? []).map((item) => ({
        componentProductId: item.componentProduct.id,
        name: item.componentProduct.name,
        quantity: item.quantity,
      })),
    );
  }, [product, bundle.data]);

  const save = useMutation({
    mutationFn: async () =>
      put(`/api/products/${product?.id}/bundle`, {
        name,
        items: items.map((item) => ({
          componentProductId: item.componentProductId,
          quantity: Number(item.quantity),
        })),
      }),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ['/api/products', product?.id, 'bundle'] });
    },
    onError: setError,
  });

  return (
    <>
      <PageHeader
        title="Product bundles"
        subtitle="Selling a bundle reserves and consumes its component stock"
      />

      {error ? (
        <div className="mb-4">
          <ErrorState error={error} />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <Field label="Bundle product" hint="Search a combo or bundled product">
            <ProductPicker onSelect={setProduct} />
          </Field>
          {product ? (
            <p className="mt-3 text-sm text-slate-600">
              Editing <span className="font-medium">{product.name}</span> ({product.sku})
            </p>
          ) : (
            <EmptyState message="Pick a product to configure its components." />
          )}
        </Card>

        <Card>
          {!product ? (
            <EmptyState message="No bundle selected." />
          ) : bundle.isPending ? (
            <Spinner />
          ) : (
            <>
              <Field label="Bundle name">
                <input
                  className="input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>

              <div className="mt-4">
                <span className="label">Add component</span>
                <ProductPicker
                  onSelect={(component) =>
                    setItems((current) =>
                      component.id === product.id ||
                      current.some((item) => item.componentProductId === component.id)
                        ? current
                        : [
                            ...current,
                            {
                              componentProductId: component.id,
                              name: component.name,
                              quantity: '1',
                            },
                          ],
                    )
                  }
                />
              </div>

              <ul className="mt-3 space-y-2">
                {items.map((item, index) => (
                  <li
                    key={item.componentProductId}
                    className="flex items-center gap-3 rounded-lg border border-slate-200 p-3"
                  >
                    <span className="flex-1 text-sm">{item.name}</span>
                    <input
                      className="input max-w-[120px]"
                      type="number"
                      step="any"
                      min="0"
                      value={item.quantity}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((row, i) =>
                            i === index ? { ...row, quantity: event.target.value } : row,
                          ),
                        )
                      }
                    />
                    <span className="text-xs text-slate-400">{qty(item.quantity)} per bundle</span>
                    <button
                      type="button"
                      className="text-xs text-rose-600 hover:underline"
                      onClick={() => setItems((current) => current.filter((_, i) => i !== index))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>

              {canManage ? (
                <button
                  type="button"
                  className="btn-primary mt-4"
                  disabled={save.isPending || !name || items.length === 0}
                  onClick={() => save.mutate()}
                >
                  {save.isPending ? 'Saving…' : 'Save bundle'}
                </button>
              ) : (
                <p className="mt-4 text-sm text-slate-500">
                  You do not have permission to change bundles.
                </p>
              )}
              {saved ? (
                <p className="mt-2 text-sm text-emerald-600">Bundle configuration saved.</p>
              ) : null}
            </>
          )}
        </Card>
      </div>
    </>
  );
}
