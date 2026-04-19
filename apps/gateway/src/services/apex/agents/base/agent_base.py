"""
APEX Intelligence Swarm — Agent Base Class
Every agent in the swarm inherits from this.
Provides: lifecycle, MCP bus integration, health reporting, logging.
"""

from __future__ import annotations
import asyncio
import logging
import time
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Callable

from shared.models import (
    AgentRole, IntelMessage, IntelType, Urgency, AgentHeartbeat,
)
from shared.config import AppConfig


class AgentBase(ABC):
    """
    Base class for all APEX swarm agents.

    Every agent must:
    1. Define its role (AgentRole enum)
    2. Implement on_intel() to handle incoming intelligence
    3. Implement run_cycle() for its main loop iteration
    4. Optionally implement on_startup() and on_shutdown()
    """

    def __init__(self, config: AppConfig, bus: "IntelligenceBus"):
        self.config = config
        self.bus = bus
        self.role: AgentRole = self._get_role()
        self.logger = logging.getLogger(f"apex.{self.role.value}")
        self._running = False
        self._start_time: float = 0
        self._messages_processed: int = 0
        self._last_error: str = ""
        self._subscriptions: list[IntelType] = []

        # Load SOUL.md for this agent
        self.soul = self._load_soul()
        self.skill = self._load_skill()

    @abstractmethod
    def _get_role(self) -> AgentRole:
        """Return this agent's role."""
        ...

    @abstractmethod
    async def on_intel(self, message: IntelMessage):
        """Handle an incoming intelligence message from the bus."""
        ...

    @abstractmethod
    async def run_cycle(self):
        """Execute one iteration of this agent's main loop."""
        ...

    async def on_startup(self):
        """Called once when agent starts. Override for setup."""
        pass

    async def on_shutdown(self):
        """Called once when agent stops. Override for cleanup."""
        pass

    # =========================================================================
    # LIFECYCLE
    # =========================================================================

    async def start(self):
        """Start this agent's main loop and subscribe to the bus."""
        self.logger.info(f"[{self.role.value}] Starting agent...")
        self._running = True
        self._start_time = time.time()

        # Register with the bus
        self.bus.register_agent(self.role, self._handle_message)

        # Subscribe to relevant intel types
        for intel_type in self._subscriptions:
            self.bus.subscribe(self.role, intel_type)

        await self.on_startup()
        self.logger.info(f"[{self.role.value}] Agent online.")

        # Main loop
        try:
            while self._running:
                try:
                    await self.run_cycle()
                except Exception as e:
                    self._last_error = str(e)
                    self.logger.error(f"[{self.role.value}] Cycle error: {e}", exc_info=True)
                await asyncio.sleep(0.1)  # Prevent tight loop
        finally:
            await self.on_shutdown()
            self.logger.info(f"[{self.role.value}] Agent offline.")

    def stop(self):
        """Signal the agent to stop."""
        self._running = False

    async def _handle_message(self, message: IntelMessage):
        """Internal message handler with error tracking."""
        try:
            if message.is_expired():
                self.logger.debug(f"[{self.role.value}] Dropping expired message {message.id}")
                return
            await self.on_intel(message)
            self._messages_processed += 1
        except Exception as e:
            self._last_error = str(e)
            self.logger.error(f"[{self.role.value}] Error handling intel: {e}", exc_info=True)

    # =========================================================================
    # PUBLISHING
    # =========================================================================

    async def publish(
        self,
        intel_type: IntelType,
        market_id: str = "",
        venue: str = "kalshi",
        payload: dict = None,
        confidence: float = 0.0,
        urgency: Urgency = Urgency.MEDIUM,
        correlation_id: str = None,
        ttl_seconds: int = 300,
    ):
        """Publish intelligence to the bus."""
        msg = IntelMessage(
            source_agent=self.role,
            intel_type=intel_type,
            urgency=urgency,
            market_id=market_id,
            venue=venue,
            payload=payload or {},
            confidence=confidence,
            ttl_seconds=ttl_seconds,
            correlation_id=correlation_id,
        )
        await self.bus.publish(msg)

    # =========================================================================
    # HEALTH
    # =========================================================================

    def get_heartbeat(self) -> AgentHeartbeat:
        """Generate a health report."""
        uptime = time.time() - self._start_time if self._start_time else 0
        return AgentHeartbeat(
            agent_role=self.role,
            status="healthy" if self._running and not self._last_error else "degraded",
            uptime_seconds=uptime,
            messages_processed=self._messages_processed,
            last_error=self._last_error,
        )

    # =========================================================================
    # SOUL & SKILL LOADING
    # =========================================================================

    def _load_soul(self) -> str:
        """Load this agent's SOUL.md identity file."""
        soul_path = Path(f"agents/{self.role.value}/SOUL.md")
        if soul_path.exists():
            return soul_path.read_text()
        self.logger.warning(f"No SOUL.md found at {soul_path}")
        return ""

    def _load_skill(self) -> str:
        """Load this agent's SKILL.md capability file."""
        skill_path = Path(f"agents/{self.role.value}/SKILL.md")
        if skill_path.exists():
            return skill_path.read_text()
        self.logger.warning(f"No SKILL.md found at {skill_path}")
        return ""

    def _load_reference(self, name: str) -> str:
        """Load a reference document for this agent."""
        ref_path = Path(f"agents/{self.role.value}/references/{name}")
        if ref_path.exists():
            return ref_path.read_text()
        return ""

    # =========================================================================
    # UTILITY
    # =========================================================================

    def is_kill_switch_active(self) -> bool:
        """Check if the emergency stop file exists."""
        return Path("data/STOP").exists()

    def is_category_allowed(self, category: str) -> bool:
        """Check if a category is allowed (score >= 30)."""
        score = self.config.categories.get(category.upper(), 0)
        return score >= 30

    def get_category_score(self, category: str) -> int:
        """Get the current score for a category."""
        return self.config.categories.get(category.upper(), 0)
