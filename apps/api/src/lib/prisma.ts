import { Prisma, PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient({
  log: process.env.PRISMA_LOG === 'true' ? ['query', 'warn', 'error'] : ['warn', 'error'],
});

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside a serializable-safe transaction. Every stock changing
 * operation must go through this helper so that a failure rolls the whole
 * operation back (inventory + ledger + document state).
 */
export function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 30_000,
  });
}
