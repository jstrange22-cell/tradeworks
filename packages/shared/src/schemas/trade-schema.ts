import { z } from 'zod';

export const MarketTypeSchema = z.enum(['crypto', 'prediction', 'equity']);
export const OrderSideSchema = z.enum(['buy', 'sell']);
export const OrderTypeSchema = z.enum(['market', 'limit', 'stop', 'stop_limit']);
export const OrderStatusSchema = z.enum(['pending', 'submitted', 'partial', 'filled', 'cancelled', 'rejected']);
export const PositionSideSchema = z.enum(['long', 'short']);

export const OrderInputSchema = z.object({
  instrument: z.string().min(1),
  market: MarketTypeSchema,
  side: OrderSideSchema,
  orderType: OrderTypeSchema,
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  stopPrice: z.number().positive().optional(),
  strategyId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type OrderInput = z.infer<typeof OrderInputSchema>;

export const ClosePositionInputSchema = z.object({
  positionId: z.string().uuid(),
  quantity: z.number().positive().optional(), // partial close
  orderType: OrderTypeSchema.default('market'),
  price: z.number().positive().optional(),
});

export type ClosePositionInput = z.infer<typeof ClosePositionInputSchema>;
