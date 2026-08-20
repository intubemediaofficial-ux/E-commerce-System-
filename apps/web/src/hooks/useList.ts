'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { get, type PageMeta, type QueryValue } from '@/lib/api';

export interface ListState {
  page: number;
  setPage: (page: number) => void;
  search: string;
  setSearch: (search: string) => void;
  filters: Record<string, QueryValue>;
  setFilter: (key: string, value: QueryValue) => void;
}

export function useListState(initialFilters: Record<string, QueryValue> = {}): ListState {
  const [page, setPage] = useState(1);
  const [search, setSearchValue] = useState('');
  const [filters, setFilters] = useState<Record<string, QueryValue>>(initialFilters);

  return {
    page,
    setPage,
    search,
    setSearch: (value: string) => {
      setSearchValue(value);
      setPage(1);
    },
    filters,
    setFilter: (key, value) => {
      setFilters((current) => ({ ...current, [key]: value }));
      setPage(1);
    },
  };
}

export interface ListResult<T> {
  rows: T[];
  meta: PageMeta;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const EMPTY_META: PageMeta = { page: 1, perPage: 20, total: 0, totalPages: 1 };

/** Server-side paginated list query bound to a `ListState`. */
export function useList<T>(path: string, state: ListState, perPage = 20): ListResult<T> {
  const query = {
    page: state.page,
    perPage,
    ...(state.search ? { search: state.search } : {}),
    ...state.filters,
  };

  const result = useQuery({
    queryKey: [path, query],
    queryFn: async () => get<T[]>(path, query),
  });

  return {
    rows: result.data?.data ?? [],
    meta: result.data?.meta ?? EMPTY_META,
    isLoading: result.isPending,
    error: result.error,
    refetch: () => void result.refetch(),
  };
}
