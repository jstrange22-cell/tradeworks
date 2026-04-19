"""
APEX Risk Agent — Portfolio Guardian
Evaluates every trade signal against 10 hard risk checks. Has VETO power.
"""

from __future__ import annotations
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

from agents.base.agent_base import AgentBase
from shared.models import (
    AgentRole, IntelType, IntelMessage, Urgency,
    RiskCheck, EngineId,
)
from shared.config import AppConfig
from shared.db import get_db, get_daily_pnl, save_risk_check


class RiskAgent(AgentBase):
    """Evaluates every trade signal against all risk checks. Can VETO trades."""

    def _get_role(self) -> AgentRole:
        return AgentRole.RISK

    def __init__(self, config: AppConfig, bus):
        super().__init__(config, bus)
        self._subscriptions = [IntelType.OPPORTUNITY, IntelType.PROBABILITY]
        self._engine_exposure: dict[str, float] = defaultdict(float)
        self._category_exposure: dict[str, float] = defaultdict(float)
        self._position_count: dict[str, int] = defaultdict(int)
        self._consecutive_losses: dict[str, int] = defaultdict(int)
        self._high_water_mark: float = config.starting_capital
        self._total_pnl: float = 0.0
        self._paused_engines: dict[str, datetime] = {}
        self._paused_categories: dict[str, datetime] = {}

    async def on_startup(self):
        self.logger.info("Risk Agent online. Guardian mode active.")

    async def on_intel(self, message: IntelMessage):
        """Evaluate signals that have probability/sizing attached."""
        if message.intel_type not in (IntelType.PROBABILITY, IntelType.OPPORTUNITY):
            return

        # Only evaluate when we have probability data
        if message.intel_type == IntelType.OPPORTUNITY:
            # If it's an arb, we can evaluate immediately
            if not message.payload.get("is_arbitrage"):
                return

        check = await self._run_all_checks(message)

        # Save to audit trail
        try:
            with get_db() as conn:
                save_risk_check(conn, check)
        except Exception as e:
            self.logger.error(f"Failed to save risk check: {e}")

        # Publish result
        if check.overall_passed:
            await self.publish(
                intel_type=IntelType.RISK_CHECK,
                market_id=message.market_id,
                venue=message.venue,
                payload={
                    "passed": True,
                    "adjusted_size": check.adjusted_size_usd,
                    "warnings": check.warnings,
                },
                confidence=0.9,
                urgency=Urgency.HIGH,
                correlation_id=message.correlation_id,
            )
        else:
            await self.publish(
                intel_type=IntelType.VETO,
                market_id=message.market_id,
                venue=message.venue,
                payload={
                    "passed": False,
                    "reason": check.reason,
                    "failed_checks": check.checks_failed,
                },
                confidence=1.0,
                urgency=Urgency.CRITICAL,
                correlation_id=message.correlation_id,
            )

    async def _run_all_checks(self, message: IntelMessage) -> RiskCheck:
        """Run all 10 risk checks. ALL must pass."""
        engine_id = self._infer_engine(message.payload)
        category = message.payload.get("category", "OTHER").upper()
        suggested_size = message.payload.get("kelly_size", 50.0)
        confidence = message.confidence

        passed = []
        failed = []
        warnings = []
        adjusted_size = suggested_size

        # CHECK 1: KILL SWITCH
        if Path("data/STOP").exists():
            failed.append("KILL_SWITCH")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0, "Kill switch active")

        passed.append("KILL_SWITCH")

        # CHECK 2: DAILY LOSS LIMIT
        try:
            with get_db() as conn:
                daily_pnl = get_daily_pnl(conn)
        except Exception:
            daily_pnl = 0.0

        max_daily = self.config.starting_capital * (self.config.risk.max_daily_drawdown_pct / 100)
        if daily_pnl < 0 and abs(daily_pnl) >= max_daily:
            failed.append("DAILY_LOSS")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Daily loss ${abs(daily_pnl):.0f} >= limit ${max_daily:.0f}")
        passed.append("DAILY_LOSS")

        # CHECK 3: TOTAL DRAWDOWN
        drawdown = self._high_water_mark - (self.config.starting_capital + self._total_pnl)
        max_drawdown = self.config.starting_capital * (self.config.risk.max_total_drawdown_pct / 100)
        if drawdown >= max_drawdown:
            failed.append("TOTAL_DRAWDOWN")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Drawdown ${drawdown:.0f} >= limit ${max_drawdown:.0f}")
        passed.append("TOTAL_DRAWDOWN")

        # CHECK 4: ENGINE ALLOCATION
        alloc_pct = self.config.risk.allocation.get(f"{engine_id}_pct", 20)
        max_engine = self.config.starting_capital * (alloc_pct / 100)
        current_exposure = self._engine_exposure.get(engine_id, 0)
        if current_exposure + suggested_size > max_engine:
            remaining = max(0, max_engine - current_exposure)
            if remaining < 10:
                failed.append("ENGINE_ALLOCATION")
                return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                         f"Engine {engine_id} at capacity: ${current_exposure:.0f}/${max_engine:.0f}")
            adjusted_size = min(adjusted_size, remaining)
            warnings.append(f"Size reduced to ${adjusted_size:.0f} (engine limit)")
        passed.append("ENGINE_ALLOCATION")

        # CHECK 5: SECTOR CONCENTRATION
        max_sector = self.config.starting_capital * (self.config.risk.max_sector_concentration_pct / 100)
        cat_exposure = self._category_exposure.get(category, 0)
        if cat_exposure + adjusted_size > max_sector:
            remaining = max(0, max_sector - cat_exposure)
            if remaining < 10:
                failed.append("SECTOR_CONCENTRATION")
                return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                         f"Category {category} at {cat_exposure/self.config.starting_capital:.0%}")
            adjusted_size = min(adjusted_size, remaining)
            warnings.append(f"Size reduced for sector limit")
        passed.append("SECTOR_CONCENTRATION")

        # CHECK 6: POSITION LIMITS
        max_pos = self.config.risk.max_positions_per_engine
        if self._position_count.get(engine_id, 0) >= max_pos:
            failed.append("POSITION_LIMITS")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Engine {engine_id} at max {max_pos} positions")
        passed.append("POSITION_LIMITS")

        # CHECK 7: CATEGORY SCORE
        cat_score = self.get_category_score(category)
        if cat_score < 30:
            failed.append("CATEGORY_SCORE")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Category {category} BLOCKED (score={cat_score})")
        if cat_score < 50:
            adjusted_size *= 0.5
            warnings.append(f"Category {category} WEAK (score={cat_score}), size halved")
        passed.append("CATEGORY_SCORE")

        # CHECK 8: CONFIDENCE MINIMUM
        if confidence < self.config.risk.min_confidence:
            failed.append("CONFIDENCE_MINIMUM")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Confidence {confidence:.2f} < min {self.config.risk.min_confidence}")
        passed.append("CONFIDENCE_MINIMUM")

        # CHECK 9: STALE DATA
        msg_age = (datetime.now(timezone.utc) - message.timestamp).total_seconds()
        if msg_age > 30:
            failed.append("STALE_DATA")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Signal is {msg_age:.0f}s old (max 30s)")
        passed.append("STALE_DATA")

        # CHECK 10: CONSECUTIVE LOSSES
        losses = self._consecutive_losses.get(engine_id, 0)
        if losses >= self.config.risk.consecutive_loss_pause_count:
            failed.append("CONSECUTIVE_LOSSES")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Engine {engine_id} on {losses}-loss streak, paused")
        cat_losses = self._consecutive_losses.get(f"cat_{category}", 0)
        if cat_losses >= self.config.risk.category_loss_pause_count:
            failed.append("CONSECUTIVE_LOSSES")
            return self._build_check(message, engine_id, passed, failed, warnings, 0.0,
                                     f"Category {category} on {cat_losses}-loss streak, paused")
        passed.append("CONSECUTIVE_LOSSES")

        return self._build_check(message, engine_id, passed, failed, warnings, adjusted_size, "All checks passed")

    def _build_check(self, message, engine_id, passed, failed, warnings, size, reason) -> RiskCheck:
        return RiskCheck(
            signal_id=message.correlation_id or message.id,
            engine_id=EngineId(engine_id) if engine_id in [e.value for e in EngineId] else EngineId.AI_ENSEMBLE,
            checks_passed=passed,
            checks_failed=failed,
            overall_passed=len(failed) == 0,
            adjusted_size_usd=size,
            warnings=warnings,
            reason=reason,
        )

    def _infer_engine(self, payload: dict) -> str:
        """Infer engine from payload."""
        if payload.get("is_arbitrage"):
            return "arb_engine"
        cat = payload.get("category", "").upper()
        if cat == "CRYPTO_15M":
            return "btc_sniper"
        if cat == "WEATHER":
            return "weather"
        if payload.get("is_new_listing"):
            return "listing_sniper"
        return "ai_ensemble"

    async def run_cycle(self):
        """Periodic portfolio state monitoring."""
        # TODO: Refresh position counts, exposure, P&L from database
        await asyncio.sleep(5.0)
