import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { config } from './server/config';
import { getDb, runMigrations } from './server/db/database';
import { seedDatabase } from './server/db/seed';
import { createApiApp } from './server/app';

async function startServer() {
  const db = getDb();
  runMigrations(db);
  seedDatabase(db);

  const app = createApiApp();

  if (config.nodeEnv !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    const assetsDir = path.join(distDir, 'src/assets');
    if (fs.existsSync(assetsDir)) {
      app.use('/src/assets', express.static(assetsDir));
    }
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`Scrap Wala server listening on http://0.0.0.0:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Scrap Wala server:', err);
  process.exit(1);
});
