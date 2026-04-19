"""
APEX Quant Agent — Probability Engine & Position Sizer
Calculates model probabilities, edge, and Kelly-optimal position sizes per category.
"""

from __future__ import annotations
import asyncio
import math
import logging

from agents.base.agent_base import AgentBase
from shared.models import AgentRole, IntelType, IntelMessage, Urgency
from shared.config import AppConfig


class QuantAgent(AgentBase):
    """Calculates probabilities, edge, and position sizes."""

    def _get_role(self) -> AgentRole:
        return AgentRole.QUANT

    def __init__(self, config: AppConfig, bus):
        super().__init__(config, bus)
        self._subscriptions = [IntelType.OPPORTUNITY]
        self._brier_scores: dict[str, list[float]] = {}  # category → scores

    async def on_startup(self):
        self.logger.info("Quant online. Ready for probability calculations.")

    async def on_intel(self, message: IntelMessage):
        """When Scout finds an opportunity, calculate probability and edge."""
        if message.intel_type != IntelType.OPPORTUNITY:
            return

        category = message.payload.get("category", "OTHER").upper()
        market_id = message.market_id
        yes_price = message.payload.get("yes_price", 0.5)
        is_arb = message.payload.get("is_arbitrage", False)

        # Skip blocked categories
        if not self.is_category_allowed(category) and not is_arb:
            return

        # Dispatch to correct model
        if is_arb:
            result = await self._calc_arbitrage(message.payload)
        elif category == "WEATHER":
            result = await self._calc_weather(message.payload)
        elif category == "CRYPTO_15M":
            result = await self._calc_crypto_microstructure(message.payload)
        elif category in ("NCAAB", "NBA", "NFL", "MLB", "NHL", "POLITICS"):
            result = await self._calc_ai_ensemble(message.payload)
        else:
            result = await self._calc_ai_ensemble(message.payload)

        if not result:
            return

        # Calculate Kelly position size
        model_prob = result["probability"]
        edge = abs(model_prob - yes_price)
        side = "yes" if model_prob > yes_price else "no"

        kelly_size = self._kelly_size(
            win_probability=model_prob if side == "yes" else (1 - model_prob),
            price=yes_price if side == "yes" else (1 - yes_price),
            bankroll=self.config.starting_capital * (
                self.config.risk.allocation.get(
                    self._engine_for_category(category), 20
                ) / 100
            ),
        )

        # Edge threshold check
        min_edge = self._min_edge_for_category(category)
        if edge < min_edge:
            return  # Not enough edge

        await self.publish(
            intel_type=IntelType.PROBABILITY,
            market_id=market_id,
            venue=message.venue,
            payload={
                "probability": model_prob,
                "model_prob": model_prob,
                "edge": edge,
                "side": side,
                "kelly_size": kelly_size,
                "method": result.get("method", "unknown"),
                "confidence_interval": result.get("confidence_interval"),
            },
            confidence=result.get("confidence", 0.5),
            urgency=Urgency.HIGH if is_arb else Urgency.MEDIUM,
            correlation_id=message.correlation_id,
        )

    # =========================================================================
    # MODEL IMPLEMENTATIONS
    # =========================================================================

    async def _calc_arbitrage(self, payload: dict) -> dict | None:
        """Pure math arbitrage calculation."""
        yes_ask = payload.get("yes_ask", 0)
        no_ask = payload.get("no_ask", 0)
        total = yes_ask + no_ask

        if total >= 1.0:
            return None

        # Fee estimation (Kalshi)
        contracts = 100  # estimate
        fee = math.ceil(0.07 * contracts * yes_ask * (1 - yes_ask)) / 100

        net_profit = (1.0 - total) - fee
        if net_profit <= 0:
            return None

        return {
            "probability": 1.0,  # Arb is "certain"
            "confidence": 0.95,
            "method": "arbitrage_math",
            "net_profit_per_contract": net_profit,
        }

    async def _calc_weather(self, payload: dict) -> dict | None:
        """GFS 31-member ensemble for weather markets."""
        # TODO: Call Open-Meteo ensemble API
        # https://ensemble-api.open-meteo.com/v1/ensemble
        # Parse 31 member forecasts, count members above threshold
        # probability = members_above / 31
        # confidence = abs(members_above - 15.5) / 15.5
        return {
            "probability": 0.5,
            "confidence": 0.0,
            "method": "gfs_ensemble_placeholder",
        }

    async def _calc_crypto_microstructure(self, payload: dict) -> dict | None:
        """BTC/ETH/SOL microstructure signals."""
        # TODO: Implement real-time signal calculation
        # Signals: RSI(14), Momentum(1m/5m/15m), VWAP dev, SMA cross, Order flow
        # Composite = weighted sum normalized to [0, 1]
        return {
            "probability": 0.5,
            "confidence": 0.0,
            "method": "microstructure_placeholder",
        }

    async def _calc_ai_ensemble(self, payload: dict) -> dict | None:
        """Multi-model AI ensemble via OpenRouter."""
        # TODO: Implement 5-model ensemble
        # For each model: send market context, get probability + confidence
        # Aggregate with weighted voting
        # Check daily AI budget before making calls
        return {
            "probability": 0.5,
            "confidence": 0.0,
            "method": "ai_ensemble_placeholder",
        }

    # =========================================================================
    # KELLY CRITERION
    # =========================================================================

    def _kelly_size(
        self,
        win_probability: float,
        price: float,
        bankroll: float,
        kelly_fraction: float = None,
    ) -> float:
        """Calculate fractional Kelly position size."""
        kf = kelly_fraction or self.config.risk.kelly_fraction
        if price <= 0 or price >= 1:
            return 0.0

        b = (1 - price) / price  # payout odds
        q = 1 - win_probability
        f_star = (win_probability * b - q) / b
        f_star = max(f_star, 0)

        position = f_star * kf * bankroll
        position = min(position, bankroll * 0.05)  # 5% cap
        position = min(position, 100.0)  # $100 hard cap default
        return round(max(position, 0), 2)

    def _min_edge_for_category(self, category: str) -> float:
        """Minimum edge required per category."""
        thresholds = {
            "WEATHER": 0.08,
            "CRYPTO_15M": 0.02,
            "NCAAB": 0.05,
            "NBA": 0.05,
            "NFL": 0.05,
            "POLITICS": 0.07,
        }
        return thresholds.get(category, 0.05)

    def _engine_for_category(self, category: str) -> str:
        """Map category to engine allocation key."""
        if category == "CRYPTO_15M":
            return "btc_sniper_pct"
        if category == "WEATHER":
            return "weather_pct"
        return "ai_ensemble_pct"

    async def run_cycle(self):
        await asyncio.sleep(1.0)
