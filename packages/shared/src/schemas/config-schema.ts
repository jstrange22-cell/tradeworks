import { z } from 'zod';

export const EngineConfigSchema = z.object({
  cycleIntervalMs: z.number().min(10000).default(300000), // 5 min default
  maxTurnsPerCycle: z.number().min(5).max(100).default(50),
  maxBudgetPerCycleUsd: z.number().min(0.1).max(50).default(5.0),
  paperTrading: z.boolean().default(true),
  enabledMarkets: z.array(z.enum(['crypto', 'prediction', 'equity'])).min(1),
  instruments: z.object({
    crypto: z.array(z.string()).default([]),
    prediction: z.array(z.string()).default([]),
    equity: z.array(z.string()).default([]),
  }),
});

export const DatabaseConfigSchema = z.object({
  postgres: z.object({
    connectionString: z.string(),
    poolSize: z.number().min(1).max(50).default(10),
  }),
  clickhouse: z.object({
    url: z.string(),
    database: z.string().default('tradeworks'),
  }),
  redis: z.object({
    url: z.string(),
  }),
});

export const ExchangeConfigSchema = z.object({
  coinbase: z.object({
    apiKeyId: z.string(),
    apiKeySecret: z.string(),
    networkId: z.string().default('base-mainnet'),
  }).optional(),
  alpaca: z.object({
    apiKey: z.string(),
    secretKey: z.string(),
    paperTrading: z.boolean().default(true),
  }).optional(),
  polymarket: z.object({
    privateKey: z.string(),
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
    passphrase: z.string().optional(),
  }).optional(),
});

export const AppConfigSchema = z.object({
  engine: EngineConfigSchema,
  database: DatabaseConfigSchema,
  exchanges: ExchangeConfigSchema,
  api: z.object({
    port: z.number().default(3001),
    jwtSecret: z.string(),
    corsOrigins: z.array(z.string()).default(['http://localhost:5173']),
  }),
});

export type EngineConfig = z.infer<typeof EngineConfigSchema>;
export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;
export type ExchangeConfig = z.infer<typeof ExchangeConfigSchema>;
export type AppConfig = z.infer<typeof AppConfigSchema>;
