"""
APEX Memory Agent — Institutional Memory & Pattern Matching
Stores every trade with full context. Recalls similar historical patterns
when the swarm evaluates new opportunities.
"""

from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, timezone

from agents.base.agent_base import AgentBase
from shared.models import (
    AgentRole, IntelType, IntelMessage, Urgency,
    TradeMemory, PatternMatch,
)
from shared.config import AppConfig
from shared.db import get_db, save_memory


class MemoryAgent(AgentBase):
    """Stores trade history and recalls similar patterns for new opportunities."""

    def _get_role(self) -> AgentRole:
        return AgentRole.MEMORY

    def __init__(self, config: AppConfig, bus):
        super().__init__(config, bus)
        self._subscriptions = [
            IntelType.OPPORTUNITY,
            IntelType.EXECUTION,
        ]
        # In-memory pattern index for fast lookups
        self._pattern_index: dict[str, list[TradeMemory]] = {}  # category → memories
        self._vector_store = None  # ChromaDB instance (initialized on startup)

    async def on_startup(self):
        self.logger.info("Memory Agent online. Loading trade history.")
        await self._load_history()
        await self._init_vector_store()

    async def on_intel(self, message: IntelMessage):
        """Handle incoming intelligence."""

        if message.intel_type == IntelType.OPPORTUNITY:
            await self._recall_patterns(message)

        elif message.intel_type == IntelType.EXECUTION:
            await self._store_execution(message)

    async def _recall_patterns(self, message: IntelMessage):
        """Search for similar historical trades and report patterns."""
        category = message.payload.get("category", "OTHER").upper()
        title = message.payload.get("title", "")
        yes_price = message.payload.get("yes_price", 0.5)

        # Method 1: Category-based pattern matching
        category_memories = self._pattern_index.get(category, [])

        if not category_memories:
            await self.publish(
                intel_type=IntelType.MEMORY_RECALL,
                market_id=message.market_id,
                venue=message.venue,
                payload={
                    "similar_trades": 0,
                    "historical_win_rate": 0.5,
                    "avg_profit_loss": 0.0,
                    "confidence": 0.0,
                    "description": f"No historical data for category {category}",
                    "pattern_name": "no_history",
                },
                confidence=0.0,
                correlation_id=message.correlation_id,
            )
            return

        # Find similar trades by category + price range
        price_range = 0.15  # ±15% of current price
        similar = [
            m for m in category_memories
            if abs(m.entry_price - yes_price) < price_range
        ]

        # If we have vector store, also do semantic search
        if self._vector_store and title:
            semantic_matches = await self._semantic_search(title, category, top_k=10)
            # Merge with price-based matches, deduplicate
            seen_ids = {m.trade_id for m in similar}
            for sm in semantic_matches:
                if sm.trade_id not in seen_ids:
                    similar.append(sm)
                    seen_ids.add(sm.trade_id)

        if not similar:
            similar = category_memories[-20:]  # Fall back to recent category trades

        # Calculate pattern statistics
        total = len(similar)
        wins = sum(1 for m in similar if m.won)
        win_rate = wins / total if total > 0 else 0.5
        avg_pnl = sum(m.profit_loss for m in similar) / total if total > 0 else 0.0

        # Confidence based on sample size
        if total >= 20:
            confidence = 0.8
        elif total >= 10:
            confidence = 0.6
        elif total >= 5:
            confidence = 0.4
        else:
            confidence = 0.2

        # Apply decay — weight recent trades more heavily
        recent_trades = sorted(similar, key=lambda m: m.timestamp, reverse=True)[:10]
        recent_win_rate = sum(1 for m in recent_trades if m.won) / len(recent_trades) if recent_trades else 0.5

        # Detect patterns
        pattern = self._identify_pattern(similar, yes_price, category)

        await self.publish(
            intel_type=IntelType.MEMORY_RECALL,
            market_id=message.market_id,
            venue=message.venue,
            payload={
                "similar_trades": total,
                "historical_win_rate": round(win_rate, 3),
                "recent_win_rate": round(recent_win_rate, 3),
                "avg_profit_loss": round(avg_pnl, 2),
                "confidence": confidence,
                "pattern_name": pattern.pattern_name,
                "description": pattern.description,
                "warning": win_rate < 0.4,
            },
            confidence=confidence,
            urgency=Urgency.HIGH if win_rate < 0.3 else Urgency.MEDIUM,
            correlation_id=message.correlation_id,
        )

    async def _store_execution(self, message: IntelMessage):
        """Store a completed trade execution for future pattern matching."""
        payload = message.payload
        if payload.get("status") != "filled":
            return

        memory = TradeMemory(
            trade_id=payload.get("execution_id", ""),
            engine_id=payload.get("engine_id", "ai_ensemble"),
            market_id=message.market_id,
            category=payload.get("category", "OTHER"),
            side=payload.get("side", "yes"),
            entry_price=payload.get("fill_price", 0),
            confidence_at_entry=message.confidence,
            context_summary=json.dumps(payload),
        )

        # Add to in-memory index
        category = memory.category.upper()
        if category not in self._pattern_index:
            self._pattern_index[category] = []
        self._pattern_index[category].append(memory)

        # Persist to database
        try:
            with get_db() as conn:
                save_memory(conn, memory)
        except Exception as e:
            self.logger.error(f"Failed to save memory: {e}")

        # Add to vector store
        if self._vector_store:
            await self._add_to_vector_store(memory)

    def _identify_pattern(self, trades: list[TradeMemory], current_price: float, category: str) -> PatternMatch:
        """Identify named patterns from historical trades."""
        total = len(trades)
        wins = sum(1 for t in trades if t.won)
        win_rate = wins / total if total > 0 else 0.5

        # Pattern: Strong NO-side edge in sports
        no_side_trades = [t for t in trades if t.side == "no"]
        if no_side_trades and category in ("NCAAB", "NBA", "NFL"):
            no_wins = sum(1 for t in no_side_trades if t.won)
            no_rate = no_wins / len(no_side_trades) if no_side_trades else 0
            if no_rate > 0.65 and len(no_side_trades) >= 5:
                return PatternMatch(
                    pattern_name="sports_no_side_edge",
                    similar_trades=len(no_side_trades),
                    historical_win_rate=no_rate,
                    avg_profit_loss=sum(t.profit_loss for t in no_side_trades) / len(no_side_trades),
                    confidence=0.7,
                    description=f"NO-side in {category} has {no_rate:.0%} win rate over {len(no_side_trades)} trades",
                )

        # Pattern: Price extreme (very high or low YES price)
        if current_price > 0.85 or current_price < 0.15:
            extreme_trades = [t for t in trades if t.entry_price > 0.85 or t.entry_price < 0.15]
            if extreme_trades:
                ext_wins = sum(1 for t in extreme_trades if t.won)
                ext_rate = ext_wins / len(extreme_trades)
                return PatternMatch(
                    pattern_name="price_extreme",
                    similar_trades=len(extreme_trades),
                    historical_win_rate=ext_rate,
                    avg_profit_loss=sum(t.profit_loss for t in extreme_trades) / len(extreme_trades),
                    confidence=0.5,
                    description=f"Extreme price ({current_price:.0%}) historically has {ext_rate:.0%} win rate",
                )

        # Default: category baseline
        return PatternMatch(
            pattern_name="category_baseline",
            similar_trades=total,
            historical_win_rate=win_rate,
            avg_profit_loss=sum(t.profit_loss for t in trades) / total if total > 0 else 0,
            confidence=0.3 if total < 10 else 0.5,
            description=f"{category} baseline: {win_rate:.0%} win rate over {total} trades",
        )

    # =========================================================================
    # VECTOR STORE (ChromaDB)
    # =========================================================================

    async def _init_vector_store(self):
        """Initialize ChromaDB for semantic pattern search."""
        try:
            import chromadb
            self._vector_store = chromadb.Client()
            self._collection = self._vector_store.get_or_create_collection(
                name="trade_memories",
                metadata={"hnsw:space": "cosine"},
            )
            self.logger.info(f"Vector store initialized with {self._collection.count()} memories")
        except ImportError:
            self.logger.warning("ChromaDB not installed — semantic search disabled. pip install chromadb")
        except Exception as e:
            self.logger.warning(f"Vector store init failed: {e}")

    async def _semantic_search(self, query: str, category: str, top_k: int = 10) -> list[TradeMemory]:
        """Search vector store for semantically similar trades."""
        if not self._vector_store:
            return []
        try:
            results = self._collection.query(
                query_texts=[query],
                n_results=top_k,
                where={"category": category} if category else None,
            )
            # Convert results back to TradeMemory objects
            memories = []
            if results and results.get("metadatas"):
                for meta in results["metadatas"][0]:
                    memories.append(TradeMemory(**meta))
            return memories
        except Exception as e:
            self.logger.error(f"Semantic search failed: {e}")
            return []

    async def _add_to_vector_store(self, memory: TradeMemory):
        """Add a trade memory to the vector store."""
        if not self._vector_store:
            return
        try:
            self._collection.add(
                documents=[memory.context_summary or memory.market_question or ""],
                metadatas=[memory.model_dump(mode="json")],
                ids=[memory.trade_id],
            )
        except Exception as e:
            self.logger.error(f"Failed to add to vector store: {e}")

    async def _load_history(self):
        """Load historical trades from database into memory."""
        try:
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT * FROM trade_memories ORDER BY timestamp DESC LIMIT 5000"
                ).fetchall()
                for row in rows:
                    mem = TradeMemory(
                        trade_id=row["trade_id"],
                        engine_id=row["engine_id"],
                        market_id=row["market_id"],
                        category=row["category"] or "OTHER",
                        side=row["side"],
                        entry_price=row["entry_price"],
                        exit_price=row["exit_price"] or 0,
                        profit_loss=row["profit_loss"] or 0,
                        won=bool(row["won"]),
                        confidence_at_entry=row["confidence_at_entry"] or 0,
                    )
                    cat = mem.category.upper()
                    if cat not in self._pattern_index:
                        self._pattern_index[cat] = []
                    self._pattern_index[cat].append(mem)

                total = sum(len(v) for v in self._pattern_index.values())
                self.logger.info(f"Loaded {total} trade memories across {len(self._pattern_index)} categories")
        except Exception as e:
            self.logger.warning(f"Could not load history: {e}")

    async def run_cycle(self):
        await asyncio.sleep(5.0)
