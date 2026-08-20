import path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      ENABLE_QUEUES: 'false',
      DATABASE_URL: process.env.DATABASE_URL ?? '',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      JWT_SECRET: process.env.JWT_SECRET ?? 'test-access-secret',
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret',
    },
  },
});
