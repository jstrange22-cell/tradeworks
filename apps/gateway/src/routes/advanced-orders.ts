import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  createTwapPlan,
  createVwapPlan,
  createIcebergPlan,
} from '../services/advanced-orders-service.js';

/**
 * Advanced order routes.
 * POST /twap    - Create a TWAP execution plan
 * POST /vwap    - Create a VWAP execution plan
 * POST /iceberg - Create an iceberg execution plan
 *
 * All endpoints return calculated order plans without executing trades.
 */

export const advancedOrdersRouter: RouterType = Router();

// --- Schemas ---

const SideSchema = z.enum(['buy', 'sell']);

const TwapSchema = z.object({
  instrument: z.string().min(1, 'Instrument is required'),
  side: SideSchema,
  totalQuantity: z.number().positive('Total quantity must be positive'),
  slices: z.number().int().min(2, 'Must have at least 2 slices').max(1000, 'Max 1000 slices'),
  durationMinutes: z.number().positive('Duration must be positive').max(1440, 'Max 24 hours'),
});

const VwapSchema = z.object({
  instrument: z.string().min(1, 'Instrument is required'),
  side: SideSchema,
  totalQuantity: z.number().positive('Total quantity must be positive'),
  slices: z.number().int().min(2, 'Must have at least 2 slices').max(1000, 'Max 1000 slices'),
  volumeProfile: z
    .array(z.number().nonnegative('Weights must be non-negative'))
    .min(2, 'Profile must have at least 2 entries')
    .optional(),
});

const IcebergSchema = z.object({
  instrument: z.string().min(1, 'Instrument is required'),
  side: SideSchema,
  totalQuantity: z.number().positive('Total quantity must be positive'),
  displayQuantity: z.number().positive('Display quantity must be positive'),
  price: z.number().positive('Price must be positive'),
}).refine(
  (data) => data.displayQuantity <= data.totalQuantity,
  { message: 'Display quantity must be less than or equal to total quantity', path: ['displayQuantity'] },
);

// --- Routes ---

/**
 * POST /twap
 * Create a TWAP (Time-Weighted Average Price) execution plan.
 */
advancedOrdersRouter.post('/twap', (req, res) => {
  try {
    const body = TwapSchema.parse(req.body);
    const plan = createTwapPlan(body);

    res.status(200).json({
      data: plan,
      message: `TWAP plan: ${body.slices} slices of ${body.instrument} over ${body.durationMinutes} minutes`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid TWAP request',
        details: error.errors,
      });
      return;
    }
    res.status(500).json({ error: 'Failed to create TWAP plan' });
  }
});

/**
 * POST /vwap
 * Create a VWAP (Volume-Weighted Average Price) execution plan.
 */
advancedOrdersRouter.post('/vwap', (req, res) => {
  try {
    const body = VwapSchema.parse(req.body);
    const plan = createVwapPlan(body);

    res.status(200).json({
      data: plan,
      message: `VWAP plan: ${body.slices} volume-weighted slices of ${body.instrument}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid VWAP request',
        details: error.errors,
      });
      return;
    }
    res.status(500).json({ error: 'Failed to create VWAP plan' });
  }
});

/**
 * POST /iceberg
 * Create an Iceberg execution plan.
 */
advancedOrdersRouter.post('/iceberg', (req, res) => {
  try {
    const body = IcebergSchema.parse(req.body);
    const plan = createIcebergPlan(body);

    res.status(200).json({
      data: plan,
      message: `Iceberg plan: showing ${body.displayQuantity} of ${body.totalQuantity} ${body.instrument} @ $${body.price}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: 'Invalid Iceberg request',
        details: error.errors,
      });
      return;
    }
    res.status(500).json({ error: 'Failed to create Iceberg plan' });
  }
});
