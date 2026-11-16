import express from 'express';
import { securityHeaders } from './middleware/auth';
import authRoutes from './routes/auth';
import publicRoutes from './routes/public';
import mediaRoutes from './routes/media';
import aiRoutes from './routes/ai';
import sellerRoutes from './routes/seller';
import buyerRoutes from './routes/buyer';
import collectorRoutes from './routes/collector';
import adminRoutes from './routes/admin';
import notificationRoutes from './routes/notifications';

export function createApiApp(): express.Express {
  const app = express();
  app.use(securityHeaders);
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'scrap-wala-api', version: 'v1' });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/public', publicRoutes);
  app.use('/api/v1/media', mediaRoutes);
  app.use('/api/v1/ai', aiRoutes);
  app.use('/api/v1/seller', sellerRoutes);
  app.use('/api/v1/buyer', buyerRoutes);
  app.use('/api/v1/collector', collectorRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/notifications', notificationRoutes);

  app.use('/api/v1/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    res.status(500).json({ error: message });
  });

  return app;
}
