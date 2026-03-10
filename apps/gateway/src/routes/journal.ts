import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import {
  getJournalEntries,
  getJournalEntry,
  getJournalByTradeId,
  getJournalEntriesByDateRange,
  createJournalEntry,
  updateJournalEntry,
  deleteJournalEntry,
  getJournalTagStats,
} from '@tradeworks/db';

/**
 * Trade Journal CRUD endpoints.
 * POST   /api/v1/journal         — Create entry
 * GET    /api/v1/journal         — List entries (optional date range)
 * GET    /api/v1/journal/tags    — Tag statistics
 * GET    /api/v1/journal/:id     — Get single entry
 * PATCH  /api/v1/journal/:id     — Update entry
 * DELETE /api/v1/journal/:id     — Delete entry
 * GET    /api/v1/journal/trade/:tradeId — Get entry by linked trade
 */

export const journalRouter: RouterType = Router();

const CreateJournalSchema = z.object({
  tradeId: z.string().uuid().optional().nullable(),
  instrument: z.string().max(50).optional().nullable(),
  market: z.enum(['crypto', 'equities', 'forex', 'futures', 'options']).optional().nullable(),
  side: z.enum(['buy', 'sell']).optional().nullable(),
  entryPrice: z.string().optional().nullable(),
  exitPrice: z.string().optional().nullable(),
  pnl: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  tags: z.array(z.string()).optional().default([]),
  emotionalState: z.enum([
    'confident', 'anxious', 'neutral', 'fomo',
    'fearful', 'greedy', 'disciplined', 'impulsive',
  ]).optional().nullable(),
  lessonsLearned: z.string().optional().nullable(),
  strategyUsed: z.string().max(255).optional().nullable(),
  rating: z.number().int().min(1).max(5).optional().nullable(),
  screenshots: z.array(z.string()).optional().default([]),
});

const UpdateJournalSchema = CreateJournalSchema.partial();

// GET / — List entries
journalRouter.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;
    const tag = req.query.tag as string | undefined;

    let entries;
    if (from && to) {
      entries = await getJournalEntriesByDateRange(new Date(from), new Date(to), limit);
    } else {
      entries = await getJournalEntries(limit);
    }

    // Filter by tag if specified
    if (tag) {
      entries = entries.filter((e) => {
        const tags = (e.tags ?? []) as string[];
        return tags.includes(tag);
      });
    }

    res.json({ data: entries, total: entries.length });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch journal entries' });
  }
});

// GET /tags — Tag statistics
journalRouter.get('/tags', async (_req, res) => {
  try {
    const stats = await getJournalTagStats();
    res.json({ data: stats });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tag statistics' });
  }
});

// GET /trade/:tradeId — Get entry by linked trade
journalRouter.get('/trade/:tradeId', async (req, res) => {
  try {
    const entry = await getJournalByTradeId(req.params.tradeId);
    if (!entry) {
      res.status(404).json({ error: 'No journal entry for this trade' });
      return;
    }
    res.json({ data: entry });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch journal entry' });
  }
});

// GET /:id — Get single entry
journalRouter.get('/:id', async (req, res) => {
  try {
    const entry = await getJournalEntry(req.params.id);
    if (!entry) {
      res.status(404).json({ error: 'Journal entry not found' });
      return;
    }
    res.json({ data: entry });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch journal entry' });
  }
});

// POST / — Create entry
journalRouter.post('/', async (req, res) => {
  try {
    const body = CreateJournalSchema.parse(req.body);
    const entry = await createJournalEntry(body);
    res.status(201).json({ data: entry, message: 'Journal entry created' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid data', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to create journal entry' });
  }
});

// PATCH /:id — Update entry
journalRouter.patch('/:id', async (req, res) => {
  try {
    const body = UpdateJournalSchema.parse(req.body);
    const entry = await updateJournalEntry(req.params.id, body);
    if (!entry) {
      res.status(404).json({ error: 'Journal entry not found' });
      return;
    }
    res.json({ data: entry, message: 'Journal entry updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid data', details: error.errors });
      return;
    }
    res.status(500).json({ error: 'Failed to update journal entry' });
  }
});

// DELETE /:id — Delete entry
journalRouter.delete('/:id', async (req, res) => {
  try {
    await deleteJournalEntry(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete journal entry' });
  }
});
