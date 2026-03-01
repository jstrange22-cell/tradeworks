/**
 * Test Express app factory.
 * Creates a minimal Express app with routes mounted but no server started.
 * All database calls are mocked so tests run without external services.
 */
import express, { type Express } from 'express';
import { healthRouter } from '../routes/health.js';
import { portfolioRouter } from '../routes/portfolio.js';
import { riskRouter } from '../routes/risk.js';
import { strategiesRouter } from '../routes/strategies.js';

export function createTestApp(): Express {
  const app = express();
  app.use(express.json());

  // Mount routes without auth middleware
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/portfolio', portfolioRouter);
  app.use('/api/v1/risk', riskRouter);
  app.use('/api/v1/strategies', strategiesRouter);

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}
