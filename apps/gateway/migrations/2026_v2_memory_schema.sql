-- TradeWorks v2 — APEX learning memory schema
-- Idempotent: safe to run multiple times.
--
-- Tables:
--   decisions            : every reasoning event (signal -> verdict)
--   executions           : 1..N broker fills tied to a decision
--   trade_outcomes       : 1:1 realised P&L on a closed decision
--   decision_embeddings  : pgvector embedding for similarity retrieval
--
-- Notes:
--   - vector(1536) matches OpenAI text-embedding-3-small / Cohere v3.
--     Resize via ALTER TABLE if a different provider is chosen later.
--   - ivfflat needs ANALYZE after bulk inserts; lists=100 is fine for
--     ~100K rows. Reconsider when row count crosses 1M.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ───────────────────────────────────────────────────────────────────────
-- decisions
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  strategy TEXT NOT NULL,                       -- 'pead', 'regime_trend', etc.
  signal JSONB NOT NULL,                        -- the full signal envelope
  context JSONB NOT NULL,                       -- portfolio + macro + news + scout snapshot
  verdict TEXT CHECK (verdict IN ('approve','veto','escalate')),
  reasoning TEXT,
  confidence DOUBLE PRECISION CHECK (confidence BETWEEN 0 AND 1),
  adjusted_size_usd DOUBLE PRECISION,
  adjusted_stop_pct DOUBLE PRECISION,
  model_used TEXT,
  reasoning_latency_ms INTEGER,
  resolution TEXT                                -- 'executed' | 'skipped' | 'manual_override' | 'expired'
);
CREATE INDEX IF NOT EXISTS idx_decisions_created_at ON decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decisions_strategy ON decisions(strategy);
CREATE INDEX IF NOT EXISTS idx_decisions_verdict ON decisions(verdict);

-- ───────────────────────────────────────────────────────────────────────
-- executions
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id UUID NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  asset_class TEXT NOT NULL,                    -- 'equity' | 'option' | 'crypto'
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell','short','cover')),
  quantity DOUBLE PRECISION NOT NULL,
  fill_price DOUBLE PRECISION,
  fill_status TEXT NOT NULL,                    -- 'filled' | 'partial' | 'rejected' | 'pending'
  broker TEXT NOT NULL,                         -- 'alpaca_paper' | 'alpaca_live' | 'freqtrade_paper' | etc.
  raw_response JSONB
);
CREATE INDEX IF NOT EXISTS idx_executions_decision_id ON executions(decision_id);
CREATE INDEX IF NOT EXISTS idx_executions_symbol ON executions(symbol, created_at DESC);

-- ───────────────────────────────────────────────────────────────────────
-- trade_outcomes  (1-to-1 with decisions)
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_outcomes (
  decision_id UUID PRIMARY KEY REFERENCES decisions(id) ON DELETE CASCADE,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  realized_pnl_usd DOUBLE PRECISION NOT NULL,
  r_multiple DOUBLE PRECISION,                  -- realized / risked
  was_stop_hit BOOLEAN,
  was_target_hit BOOLEAN,
  holding_minutes INTEGER,
  exit_reason TEXT,                             -- 'stop' | 'target' | 'trail' | 'time' | 'apex_close' | 'manual'
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_outcomes_closed_at ON trade_outcomes(closed_at DESC);

-- ───────────────────────────────────────────────────────────────────────
-- decision_embeddings
-- ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS decision_embeddings (
  decision_id UUID PRIMARY KEY REFERENCES decisions(id) ON DELETE CASCADE,
  embedding vector(1536),                       -- adjust if using a different dim
  embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL DEFAULT 'stub'
);
CREATE INDEX IF NOT EXISTS idx_decision_embeddings_ivfflat
  ON decision_embeddings USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
