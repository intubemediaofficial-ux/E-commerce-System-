import express, { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { corsOrigins, env, isTest } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error';
import { openApiDocument } from './docs/openapi';
import authRouter from './modules/auth/auth.routes';
import { masterDataRouter } from './modules/masterdata';
import productsRouter from './modules/products/products.routes';
import inventoryRouter from './modules/inventory/inventory.routes';
import transfersRouter from './modules/inventory/transfers.routes';
import { purchasingRouter } from './modules/purchasing';
import { restaurantRouter } from './modules/restaurant';
import { ecommerceRouter } from './modules/ecommerce';
import { reportsRouter } from './modules/reports';
import { dashboardRouter } from './modules/dashboard';
import { adminRouter, notificationsRouter } from './modules/admin';

export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: corsOrigins.includes('*') ? true : corsOrigins,
      credentials: true,
      exposedHeaders: ['Content-Disposition', 'Idempotent-Replay'],
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (!isTest) {
    app.use(pinoHttp({ logger, redact: ['req.headers.authorization', 'req.body.password'] }));
  }
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.path === '/health' || req.path === '/health/ready',
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
  });

  app.get('/health/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ success: true, data: { status: 'ready', database: 'up' } });
    } catch (error) {
      logger.error({ error }, 'Readiness probe failed');
      res
        .status(503)
        .json({ success: false, error: { code: 'NOT_READY', message: 'Database unavailable.' } });
    }
  });

  app.get('/api/openapi.json', (_req, res) => res.json(openApiDocument));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDocument));

  app.use('/api/auth', authRouter);

  // Everything below requires a valid access token and is organization scoped.
  const api = express.Router();
  api.use(authenticate);
  api.use('/products', productsRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/stock-transfers', transfersRouter);
  api.use('/restaurant', restaurantRouter);
  api.use('/ecommerce', ecommerceRouter);
  api.use('/reports', reportsRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/notifications', notificationsRouter);
  api.use('/admin', adminRouter);
  api.use('/', purchasingRouter);
  api.use('/', masterDataRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
