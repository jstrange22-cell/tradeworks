// apps/gateway/src/routes/solana-shelved.ts
//
// Stub router that returns 410 Gone for any /api/v1/solana* path.
// The Solana DEX/memecoin v2 hot path was shelved on 2026-05-04 (task A3) —
// measured -91% drawdown / 18% win rate in shadow. Live code lives in
// `_archive/v2-shelved-solana/`. To restore: `git checkout pre-v2-shelve-solana`.
//
// This stub preserves the URL surface so callers get an explicit signal
// rather than a generic 404.

import { Router, type Request, type Response } from 'express';

export const solanaShelvedRouter: Router = Router();

solanaShelvedRouter.all('*', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'solana_shelved_for_v2',
    restore_tag: 'pre-v2-shelve-solana',
    message:
      'Solana DEX/memecoin hot path is shelved for v2. Code is preserved under _archive/v2-shelved-solana/. Restore with `git checkout pre-v2-shelve-solana`.',
  });
});
