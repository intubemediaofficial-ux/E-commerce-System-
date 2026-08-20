import { z } from 'zod';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().min(1).optional(),
  sortBy: z.string().trim().min(1).optional(),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type Pagination = z.infer<typeof paginationSchema>;

export const skipTake = (p: Pick<Pagination, 'page' | 'perPage'>) => ({
  skip: (p.page - 1) * p.perPage,
  take: p.perPage,
});

/** Builds a safe `orderBy` restricted to an allow-list of sortable columns. */
export function orderBy<T extends string>(
  p: Pick<Pagination, 'sortBy' | 'sortDir'>,
  allowed: readonly T[],
  fallback: T,
): Record<string, 'asc' | 'desc'> {
  const column = p.sortBy && (allowed as readonly string[]).includes(p.sortBy) ? p.sortBy : fallback;
  return { [column]: p.sortDir };
}

export const dateRange = (p: Pick<Pagination, 'from' | 'to'>) =>
  p.from || p.to ? { gte: p.from, lte: p.to } : undefined;

export const uuidParam = z.object({ id: z.string().uuid() });

export const uuid = z.string().uuid();

export const decimalString = z
  .union([z.number(), z.string()])
  .refine((v) => !Number.isNaN(Number(v)), { message: 'Must be a number' });

export const positiveDecimal = decimalString.refine((v) => Number(v) > 0, {
  message: 'Must be greater than zero',
});

export const nonNegativeDecimal = decimalString.refine((v) => Number(v) >= 0, {
  message: 'Cannot be negative',
});
