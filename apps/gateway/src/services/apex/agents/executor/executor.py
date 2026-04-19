"""
APEX Executor Agent — Precision Trade Operator
ONLY agent with write access to trading APIs. Executes Commander's orders.
"""

from __future__ import annotations
import asyncio
import time
import logging
from datetime import datetime, timezone

from agents.base.agent_base import AgentBase
from shared.models import (
    AgentRole, IntelType, IntelMessage, Urgency,
    TradeExecution, TradeSignal, TradeStatus, Venue, Side, EngineId,
)
from shared.config import AppConfig
from shared.db import get_db, save_trade


class ExecutorAgent(AgentBase):
    """Places orders on Kalshi, Polymarket, and Alpaca. The only agent that trades."""

    def _get_role(self) -> AgentRole:
        return AgentRole.EXECUTOR

    def __init__(self, config: AppConfig, bus):
        super().__init__(config, bus)
        self._subscriptions = [IntelType.CONSENSUS]
        self._pending_orders: dict[str, TradeExecution] = {}
        self._inflight: set[str] = set()  # Dedup: market_ids currently being executed

    async def on_startup(self):
        self.logger.info("Executor online. Ready to place orders.")

    async def on_intel(self, message: IntelMessage):
        """Execute trade orders from Commander."""
        if message.intel_type != IntelType.CONSENSUS:
            return

        action = message.payload.get("action")
        if action != "execute":
            return

        signal_data = message.payload.get("signal", {})
        if not signal_data:
            return

        # Dedup — don't execute same market twice simultaneously
        market_id = signal_data.get("market_id", "")
        if market_id in self._inflight:
            self.logger.warning(f"Already executing {market_id} — skipping duplicate")
            return

        self._inflight.add(market_id)
        try:
            await self._execute_trade(signal_data, message.correlation_id)
        finally:
            self._inflight.discard(market_id)

    async def _execute_trade(self, signal_data: dict, correlation_id: str):
        """Place a trade on the appropriate venue."""
        venue = signal_data.get("venue", "kalshi")
        market_id = signal_data.get("market_id", "")
        side = signal_data.get("side", "yes")
        size_usd = signal_data.get("suggested_size_usd", 0)
        market_price = signal_data.get("market_price", 0.5)
        engine_id = signal_data.get("engine_id", "ai_ensemble")

        if self.config.mode == "paper":
            execution = await self._paper_execute(signal_data)
        elif venue == "kalshi":
            execution = await self._execute_kalshi(signal_data)
        elif venue == "polymarket":
            execution = await self._execute_polymarket(signal_data)
        elif venue == "alpaca":
            execution = await self._execute_alpaca(signal_data)
        else:
            self.logger.error(f"Unknown venue: {venue}")
            return

        # Save to database
        try:
            with get_db() as conn:
                save_trade(conn, execution)
        except Exception as e:
            self.logger.error(f"Failed to save trade: {e}")

        # Report execution to swarm
        status_text = "FILLED" if execution.status == TradeStatus.FILLED else execution.status.value.upper()
        await self.publish(
            intel_type=IntelType.EXECUTION,
            market_id=market_id,
            venue=venue,
            payload={
                "execution_id": execution.id,
                "status": execution.status.value,
                "fill_price": execution.fill_price,
                "quantity": execution.quantity,
                "cost_usd": execution.cost_usd,
                "fees_usd": execution.fees_usd,
                "execution_ms": execution.execution_ms,
                "side": side,
                "engine_id": engine_id,
            },
            confidence=1.0 if execution.status == TradeStatus.FILLED else 0.5,
            urgency=Urgency.HIGH,
            correlation_id=correlation_id,
        )

        self.logger.info(
            f"[{status_text}] {market_id} | {side.upper()} @ ${execution.fill_price:.2f} "
            f"| Qty: {execution.quantity} | Cost: ${execution.cost_usd:.2f} "
            f"| Latency: {execution.execution_ms:.0f}ms"
        )

    # =========================================================================
    # VENUE EXECUTORS
    # =========================================================================

    async def _paper_execute(self, signal: dict) -> TradeExecution:
        """Simulate a trade fill for paper trading mode."""
        start = time.time()
        price = signal.get("market_price", 0.5)
        size_usd = signal.get("suggested_size_usd", 50.0)
        side = signal.get("side", "yes")

        # Simulate 1-cent slippage
        fill_price = price + 0.01 if side == "yes" else price - 0.01
        fill_price = max(0.01, min(0.99, fill_price))
        quantity = int(size_usd / fill_price)
        cost = round(quantity * fill_price, 2)

        # Simulate Kalshi fee
        import math
        fee = math.ceil(0.07 * quantity * fill_price * (1 - fill_price)) / 100

        await asyncio.sleep(0.05)  # Simulate latency
        elapsed = (time.time() - start) * 1000

        return TradeExecution(
            signal_id=signal.get("id", ""),
            engine_id=EngineId(signal.get("engine_id", "ai_ensemble")),
            market_id=signal.get("market_id", ""),
            venue=Venue(signal.get("venue", "kalshi")),
            side=Side(side),
            order_type="limit",
            requested_price=price,
            fill_price=fill_price,
            quantity=quantity,
            cost_usd=cost,
            fees_usd=fee,
            status=TradeStatus.FILLED,
            execution_ms=elapsed,
            order_id=f"paper_{int(time.time()*1000)}",
            filled_at=datetime.now(timezone.utc),
        )

    async def _execute_kalshi(self, signal: dict) -> TradeExecution:
        """Execute on Kalshi via REST API with RSA-PSS auth."""
        start = time.time()

        # TODO: Implement real Kalshi order placement
        # POST /trade-api/v2/portfolio/orders
        # Headers: RSA-PSS signed authentication
        # Body: {action, side, count, ticker, type, yes_price/no_price}

        self.logger.warning("Kalshi live execution not yet implemented — using paper mode")
        return await self._paper_execute(signal)

    async def _execute_polymarket(self, signal: dict) -> TradeExecution:
        """Execute on Polymarket CLOB with EIP-712 signing."""
        start = time.time()

        # TODO: Implement real Polymarket CLOB order placement
        # EIP-712 signing for L1, HMAC for L2
        # Submit to CLOB API at clob.polymarket.com

        self.logger.warning("Polymarket live execution not yet implemented — using paper mode")
        return await self._paper_execute(signal)

    async def _execute_alpaca(self, signal: dict) -> TradeExecution:
        """Execute on Alpaca for US equities."""
        start = time.time()

        # TODO: Implement Alpaca REST API order placement
        # POST https://paper-api.alpaca.markets/v2/orders

        self.logger.warning("Alpaca live execution not yet implemented — using paper mode")
        return await self._paper_execute(signal)

    async def run_cycle(self):
        """Monitor pending orders, check for fills and settlements."""
        # TODO: Poll venues for order status updates
        # TODO: Check for market settlements and record outcomes
        await asyncio.sleep(2.0)
