/**
 * Post-Mortem & Prompt-Evolution HTTP API.
 *
 *   GET  /api/v1/post-mortem/pending          — list pending lessons
 *   POST /api/v1/post-mortem/approve/:id      — accept a pending lesson
 *   POST /api/v1/post-mortem/reject/:id       — reject (with optional reason)
 *   POST /api/v1/post-mortem/run-now          — trigger an out-of-band run
 *   GET  /api/v1/post-mortem/heuristics       — full snapshot (active list)
 */
import { Router, type Router as RouterType } from 'express';
import {
  approveLesson,
  rejectLesson,
  readHeuristics,
  runPostMortem,
} from '../services/ai/post-mortem/index.js';

export const postMortemRouter: RouterType = Router();

postMortemRouter.get('/pending', (_req, res) => {
  const file = readHeuristics();
  res.json({ data: file.pending });
});

postMortemRouter.get('/heuristics', (_req, res) => {
  const file = readHeuristics();
  res.json({
    data: {
      pending: file.pending,
      active: file.active,
      rejected: file.rejected,
      counts: {
        pending: file.pending.length,
        active: file.active.length,
        rejected: file.rejected.length,
      },
    },
  });
});

postMortemRouter.post('/approve/:id', (req, res) => {
  const id = req.params['id'] as string;
  const approvedBy = (req.body?.approvedBy as string) ?? req.user?.email ?? 'admin';
  const lesson = approveLesson(id, approvedBy);
  if (!lesson) {
    res.status(404).json({ error: 'lesson not found in pending review' });
    return;
  }
  res.json({ data: { approved: lesson } });
});

postMortemRouter.post('/reject/:id', (req, res) => {
  const id = req.params['id'] as string;
  const rejectedBy = (req.body?.rejectedBy as string) ?? req.user?.email ?? 'admin';
  const reason = req.body?.reason as string | undefined;
  const lesson = rejectLesson(id, rejectedBy, reason);
  if (!lesson) {
    res.status(404).json({ error: 'lesson not found in pending or active' });
    return;
  }
  res.json({ data: { rejected: lesson } });
});

postMortemRouter.post('/run-now', (req, res) => {
  // Run async; respond immediately with an acknowledgment so the caller
  // doesn't have to wait on a multi-cluster Claude burst.
  void (async () => {
    try {
      await runPostMortem({
        lookbackDays: req.body?.lookbackDays,
        minLossesToRun: req.body?.minLossesToRun ?? 1, // forced runs allow shorter samples
        maxClusters: req.body?.maxClusters,
      });
    } catch {
      /* swallow — already logged inside runPostMortem */
    }
  })();
  res.json({ data: { triggered: true } });
});
