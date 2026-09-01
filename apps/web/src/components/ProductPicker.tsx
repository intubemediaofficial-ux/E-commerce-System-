'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';
import type { Product } from '@/lib/types';

/** Waits for the user to pause typing before hitting the API. */
function useDebounced(value: string, delay = 200): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Server-side product search used by document builders (purchase orders,
 * transfers, orders) so large catalogues never load fully into the browser.
 * Results stream in from the first character and are ranked by the API.
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
  const [highlight, setHighlight] = useState(0);
  const search = useDebounced(term.trim());
  const active = search.length > 0;

  const { data, isFetching } = useQuery({
    queryKey: ['/api/products', 'picker', search, productType],
    queryFn: async () =>
      (
        await get<Product[]>('/api/products', {
          search,
          perPage: 10,
          status: 'ACTIVE',
          productType,
        })
      ).data,
    enabled: active,
    placeholderData: (previous) => previous,
  });

  const results = useMemo(() => (active ? (data ?? []) : []), [active, data]);

  useEffect(() => {
    setHighlight(0);
  }, [search]);

  const choose = (product: Product): void => {
    onSelect(product);
    setTerm('');
  };

  return (
    <div className="relative">
      <input
        className="input"
        value={term}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          if (!results.length) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setHighlight((current) => (current + 1) % results.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setHighlight((current) => (current - 1 + results.length) % results.length);
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(results[highlight] ?? results[0]);
          } else if (event.key === 'Escape') {
            setTerm('');
          }
        }}
      />
      {active ? (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-lg">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-slate-400">
              {isFetching ? 'Searching…' : 'No products match this search.'}
            </li>
          ) : (
            results.map((product, index) => (
              <li key={product.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left ${
                    index === highlight ? 'bg-brand-50' : 'hover:bg-slate-50'
                  }`}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => choose(product)}
                >
                  <span className="truncate">{product.name}</span>
                  <span className="shrink-0 font-mono text-xs text-slate-400">{product.sku}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
