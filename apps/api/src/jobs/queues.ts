import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';

export const QUEUE_NAME = 'ims-maintenance';

export type JobName =
  | 'low-stock-scan'
  | 'expiry-scan'
  | 'reservation-expiry'
  | 'wastage-digest';

let connection: IORedis | null = null;
let queue: Queue | null = null;

export function redisConnection(): IORedis {
  connection ??= new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  return connection;
}

export function maintenanceQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, { connection: redisConnection() });
  return queue;
}

/** Registers the repeatable schedule used by the worker process. */
export async function scheduleRecurringJobs(): Promise<void> {
  const q = maintenanceQueue();
  const jobs: { name: JobName; pattern: string }[] = [
    { name: 'low-stock-scan', pattern: '*/30 * * * *' },
    { name: 'expiry-scan', pattern: '0 6 * * *' },
    { name: 'reservation-expiry', pattern: '*/10 * * * *' },
    { name: 'wastage-digest', pattern: '0 20 * * *' },
  ];
  for (const job of jobs) {
    await q.add(job.name, {}, { repeat: { pattern: job.pattern }, removeOnComplete: 100, removeOnFail: 100 });
  }
}
