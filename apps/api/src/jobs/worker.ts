import { Worker } from 'bullmq';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { QUEUE_NAME, JobName, redisConnection, scheduleRecurringJobs } from './queues';
import { expiryScan, lowStockScan, reservationExpiry, wastageDigest } from './tasks';

const handlers: Record<JobName, () => Promise<number>> = {
  'low-stock-scan': lowStockScan,
  'expiry-scan': expiryScan,
  'reservation-expiry': reservationExpiry,
  'wastage-digest': wastageDigest,
};

async function main(): Promise<void> {
  await scheduleRecurringJobs();

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const handler = handlers[job.name as JobName];
      if (!handler) {
        logger.warn({ job: job.name }, 'Unknown job');
        return { processed: 0 };
      }
      const processed = await handler();
      return { processed };
    },
    { connection: redisConnection(), concurrency: 2 },
  );

  worker.on('completed', (job, result) => logger.info({ job: job.name, result }, 'Job completed'));
  worker.on('failed', (job, err) => logger.error({ job: job?.name, err }, 'Job failed'));

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  logger.info('Maintenance worker started');
}

void main().catch((err) => {
  logger.error({ err }, 'Worker failed to start');
  process.exit(1);
});
