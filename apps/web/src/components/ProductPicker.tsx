'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import type { Product } from '@/lib/types';

/**
 * Server-side product search used by document builders (purchase orders,
 * transfers, orders) so large catalogues never load fully into the browser.
 */
export function ProductPicker({
  onSelect,
  productType,
  placeholder = 'Search product by name, SKU or barcode…',
}: {
  onSelect: (product: Product) => void;
  productType?: string;
  placeholder?: string;
}) {
  const [term, setTerm] = useState('');
  const { data } = useQuery({
    queryKey: ['/api/products', 'picker', term, productType],
    queryFn: async () =>
      (
        await get<Product[]>('/api/products', {
          search: term,
          perPage: 8,
          status: 'ACTIVE',
          productType,
        })
      ).data,
    enabled: term.trim().length > 1,
  });

  return (
    <div>
      <input
        className="input"
        value={term}
        placeholder={placeholder}
        onChange={(event) => setTerm(event.target.value)}
      />
      {term.trim().length > 1 && (data ?? []).length > 0 ? (
        <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow">
          {(data ?? []).map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-slate-50"
                onClick={() => {
                  onSelect(product);
                  setTerm('');
                }}
              >
                <span>{product.name}</span>
                <span className="text-xs text-slate-400">{product.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
