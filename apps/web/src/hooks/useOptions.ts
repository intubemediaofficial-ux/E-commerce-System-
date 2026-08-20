'use client';

import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

export interface Option {
  value: string;
  label: string;
}

interface Named {
  id: string;
  name: string;
  code?: string;
  sku?: string;
}

/** Loads a reference list once and maps it to `<select>` options. */
export function useOptions(path: string, extraQuery: Record<string, string> = {}) {
  const query = { perPage: 200, status: 'ACTIVE', ...extraQuery };
  const result = useQuery({
    queryKey: [path, 'options', query],
    queryFn: async () => (await get<Named[]>(path, query)).data,
    staleTime: 60_000,
  });

  const options: Option[] = (result.data ?? []).map((row) => ({
    value: row.id,
    label: row.code ? `${row.name} (${row.code})` : row.sku ? `${row.name} — ${row.sku}` : row.name,
  }));

  return { options, rows: result.data ?? [], isLoading: result.isPending };
}

export const useUnitOptions = () => useOptions('/api/units');
export const useCategoryOptions = () => useOptions('/api/categories');
export const useBrandOptions = () => useOptions('/api/brands');
export const useWarehouseOptions = () => useOptions('/api/warehouses');
export const useLocationOptions = () => useOptions('/api/locations');
export const useSupplierOptions = () => useOptions('/api/suppliers');
export const useProductOptions = (productType?: string) =>
  useOptions('/api/products', productType ? { productType } : {});
