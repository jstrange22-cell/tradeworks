"""
APEX Commander Agent — Central Intelligence Orchestrator
Receives intel from all specialist agents, calculates consensus, makes final trade decisions.
"""

from __future__ import annotations
import asyncio
import logging
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from agents.base.agent_base import AgentBase
from mcp.bus.intelligence_bus import IntelCollector
from shared.models import (
    AgentRole, IntelType, IntelMessage, Urgency,
    TradeSignal, EngineId, Venue, Side,
)
from shared.config import AppConfig


class CommanderAgent(AgentBase):
    """
    The Commander synthesizes intelligence from all agents and makes
    final TRADE / NO TRADE decisions via consensus.
    """

    def _get_role(self) -> AgentRole:
        return AgentRole.COMMANDER

    def __init__(self, config: AppConfig, bus):
        super().__init__(config, bus)
        self._subscriptions = [
            IntelType.OPPORTUNITY,
            IntelType.PROBABILITY,
            IntelType.SENTIMENT,
            IntelType.MEMORY_RECALL,
            IntelType.RISK_CHECK,
            IntelType.EXECUTION,
            IntelType.ALERT,
            IntelType.VETO,
            IntelType.HEARTBEAT,
        ]
        # Active intel collectors keyed by correlation_id
        self._collectors: dict[str, IntelCollector] = {}
        # Pending decisions queue
        self._decision_queue: asyncio.Queue = asyncio.Queue()
        # Track agent health
        self._agent_heartbeats: dict[AgentRole, IntelMessage] = {}

    async def on_startup(self):
        self.logger.info("Commander online. Awaiting intelligence from swarm.")

    async def on_intel(self, message: IntelMessage):
        """Route incoming intelligence to the appropriate collector."""

        # Track heartbeats
        if message.intel_type == IntelType.HEARTBEAT:
            self._agent_heartbeats[message.source_agent] = message
            return

        # Handle VETO immediately
        if message.intel_type == IntelType.VETO:
            self.logger.warning(
                f"VETO from {message.source_agent.value} on {message.market_id}: "
                f"{message.payload.get('reason', 'no reason given')}"
            )
            # Cancel any pending decision for this market
            cid = message.correlation_id
            if cid and cid in self._collectors:
                del self._collectors[cid]
            return

        # Handle ALERT
        if message.intel_type == IntelType.ALERT:
            self.logger.critical(
                f"ALERT from {message.source_agent.value}: {message.payload}"
            )
            return

        # Route to collector
        cid = message.correlation_id
        if not cid:
            return

        # If this is an OPPORTUNITY, create a new collector
        if message.intel_type == IntelType.OPPORTUNITY:
            collector = IntelCollector(
                correlation_id=cid,
                required_agents=[
                    AgentRole.QUANT,
                    AgentRole.RISK,
                ],
                timeout=self.config.swarm.consensus_timeout_seconds,
            )
            collector.add(message)
            self._collectors[cid] = collector
            self.logger.info(
                f"New opportunity {message.market_id} — collecting intel (cid={cid[:8]})"
            )
            # Schedule decision after timeout
            asyncio.create_task(self._schedule_decision(cid))
            return

        # Add to existing collector
        if cid in self._collectors:
            self._collectors[cid].add(message)

    async def _schedule_decision(self, correlation_id: str):
        """Wait for collector to complete, then decide."""
        collector = self._collectors.get(correlation_id)
        if not collector:
            return

        # Wait for agents to respond (or timeout)
        intel = await collector.wait()

        if correlation_id not in self._collectors:
            return  # Was cancelled (e.g., by VETO)

        # Make decision
        await self._make_decision(correlation_id, intel)

        # Cleanup
        self._collectors.pop(correlation_id, None)

    async def _make_decision(
        self, correlation_id: str, intel: dict[AgentRole, IntelMessage]
    ):
        """Synthesize all intelligence and make a TRADE / NO TRADE decision."""

        if self.is_kill_switch_active():
            self.logger.warning("Kill switch active — no trades.")
            return

        # Extract the original opportunity
        opp_msg = intel.get(AgentRole.SCOUT)
        if not opp_msg:
            # Look for opportunity in any message
            for msg in intel.values():
                if msg.intel_type == IntelType.OPPORTUNITY:
                    opp_msg = msg
                    break
        if not opp_msg:
            self.logger.debug("No opportunity found in collected intel — skipping.")
            return

        market_id = opp_msg.market_id
        venue = opp_msg.venue

        # Check for Risk approval
        risk_msg = intel.get(AgentRole.RISK)
        if risk_msg and not risk_msg.payload.get("passed", False):
            self.logger.info(
                f"[NO TRADE] {market_id} — Risk rejected: {risk_msg.payload.get('reason')}"
            )
            return

        # Gather consensus data
        consensus = self._calculate_consensus(intel)

        agents_positive = consensus["agents_positive"]
        agents_total = consensus["agents_total"]
        avg_probability = consensus["avg_probability"]
        avg_confidence = consensus["avg_confidence"]
        agreement = consensus["agreement"]
        market_price = opp_msg.payload.get("yes_price", 0.5)

        # Decision logic
        min_agents = self.config.swarm.min_agents_for_decision
        if agents_total < min_agents:
            self.logger.info(
                f"[NO TRADE] {market_id} — Only {agents_total}/{min_agents} agents responded"
            )
            return

        # Calculate edge
        edge = abs(avg_probability - market_price)
        side = Side.YES if avg_probability > market_price else Side.NO

        # Consensus-based sizing
        if agents_positive >= 5:
            size_multiplier = 1.0
        elif agents_positive >= 4:
            size_multiplier = 0.75
        elif agents_positive >= 3:
            size_multiplier = 0.50
        else:
            self.logger.info(
                f"[NO TRADE] {market_id} — Insufficient consensus: "
                f"{agents_positive}/{agents_total} positive"
            )
            return

        # Disagreement discount
        if agreement < 0.5:
            size_multiplier *= 0.5
            self.logger.info(f"Disagreement discount applied (agreement={agreement:.2f})")

        # Memory warning check
        memory_msg = intel.get(AgentRole.MEMORY)
        if memory_msg:
            hist_win_rate = memory_msg.payload.get("historical_win_rate", 0.5)
            if hist_win_rate < 0.4:
                size_multiplier *= 0.5
                self.logger.info(f"Memory warning: historical win rate {hist_win_rate:.1%}")

        # Get suggested size from Quant
        quant_msg = intel.get(AgentRole.QUANT)
        base_size = 50.0  # default
        if quant_msg:
            base_size = quant_msg.payload.get("kelly_size", 50.0)

        # Risk-adjusted size
        if risk_msg:
            risk_size = risk_msg.payload.get("adjusted_size", base_size)
            base_size = min(base_size, risk_size)

        final_size = round(base_size * size_multiplier, 2)

        # Determine engine
        engine_id = self._determine_engine(opp_msg.payload)

        # Build the trade signal
        signal = TradeSignal(
            engine_id=engine_id,
            market_id=market_id,
            venue=Venue(venue) if isinstance(venue, str) else venue,
            side=side,
            confidence=avg_confidence,
            edge_pct=edge,
            model_probability=avg_probability,
            market_price=market_price,
            suggested_size_usd=final_size,
            reasoning=self._build_reasoning(intel, consensus),
            contributing_agents=[role for role in intel.keys()],
            consensus_score=agreement,
        )

        self.logger.info(
            f"[TRADE] {market_id} | {side.value.upper()} | "
            f"Consensus: {agreement:.2f} | Size: ${final_size} | "
            f"Edge: {edge:.1%} | Agents: {agents_positive}/{agents_total}"
        )

        # Publish to Executor
        await self.publish(
            intel_type=IntelType.CONSENSUS,
            market_id=market_id,
            venue=venue,
            payload={
                "signal": signal.model_dump(),
                "action": "execute",
            },
            confidence=avg_confidence,
            urgency=Urgency.HIGH,
            correlation_id=correlation_id,
        )

    def _calculate_consensus(self, intel: dict[AgentRole, IntelMessage]) -> dict:
        """Calculate consensus metrics from all agent inputs."""
        probabilities = []
        confidences = []
        positive_signals = 0
        total_signals = 0

        for role, msg in intel.items():
            if role in (AgentRole.COMMANDER, AgentRole.EXECUTOR):
                continue

            total_signals += 1

            # Extract probability if available
            prob = msg.payload.get("probability") or msg.payload.get("model_prob")
            if prob is not None:
                probabilities.append(float(prob))

            conf = msg.confidence
            confidences.append(conf)

            # Count positive signals
            if msg.payload.get("passed", True) and conf > 0.4:
                positive_signals += 1

        avg_prob = sum(probabilities) / len(probabilities) if probabilities else 0.5
        avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

        # Agreement = 1 - stdev of probabilities
        if len(probabilities) > 1:
            mean = avg_prob
            variance = sum((p - mean) ** 2 for p in probabilities) / len(probabilities)
            agreement = max(0, 1 - (variance ** 0.5))
        else:
            agreement = 1.0

        return {
            "avg_probability": avg_prob,
            "avg_confidence": avg_conf,
            "agreement": agreement,
            "agents_positive": positive_signals,
            "agents_total": total_signals,
            "probabilities": probabilities,
        }

    def _determine_engine(self, payload: dict) -> EngineId:
        """Determine which engine this opportunity belongs to."""
        category = payload.get("category", "").upper()
        is_arb = payload.get("is_arbitrage", False)
        ticker = payload.get("ticker", "")

        if is_arb:
            return EngineId.ARB
        if "KXBTC" in ticker or "KXETH" in ticker or "KXSOL" in ticker:
            return EngineId.BTC_SNIPER
        if "KXHIGH" in ticker or category == "WEATHER":
            return EngineId.WEATHER
        if payload.get("is_new_listing", False):
            return EngineId.LISTING_SNIPER
        return EngineId.AI_ENSEMBLE

    def _build_reasoning(self, intel: dict, consensus: dict) -> str:
        """Build human-readable reasoning for audit trail."""
        parts = [f"Consensus: {consensus['agreement']:.2f} ({consensus['agents_positive']}/{consensus['agents_total']} positive)"]
        for role, msg in intel.items():
            summary = msg.payload.get("reasoning", msg.payload.get("summary", ""))
            if summary:
                parts.append(f"{role.value}: {summary[:200]}")
        return " | ".join(parts)

    async def run_cycle(self):
        """Main loop — cleanup expired collectors."""
        expired = [
            cid for cid, collector in self._collectors.items()
            if collector.is_expired()
        ]
        for cid in expired:
            self._collectors.pop(cid, None)

        await asyncio.sleep(1.0)
