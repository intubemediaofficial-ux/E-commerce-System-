'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

/**
 * Every list/summary whose numbers derive from the inventory ledger. Any stock
 * mutation invalidates all of them so quantities stay in sync between the
 * product list, inventory screens, dashboards and reports.
 */
const STOCK_QUERY_PREFIXES = [
  '/api/products',
  '/api/inventory',
  '/api/stock-transfers',
  '/api/purchase-orders',
  '/api/purchase-returns',
  '/api/ecommerce',
  '/api/reports',
  '/api/dashboard',
  '/api/notifications',
];

/** Returns a callback that refreshes every stock-derived query. */
export function useStockRefresh(): () => void {
  const queryClient = useQueryClient();

  return useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey[0];
        return typeof key === 'string' && STOCK_QUERY_PREFIXES.some((p) => key.startsWith(p));
      },
    });
  }, [queryClient]);
}
