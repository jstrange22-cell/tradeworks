# APEX INTELLIGENCE SWARM — SUPER-INTELLIGENT OPENCLAW AGENT NETWORK
## Claude Code Master Prompt | TradeWorks × Strange Digital Group
## "Make Mine Smarter Than Yours"

---

## PHASE 0 — READ THE EXISTING REPO FIRST (MANDATORY)

```bash
# Clone the reference repos
git clone https://github.com/jstrange22-cell/re-assistant /tmp/re-assistant-ref
# If there's a separate tradeworks repo, clone that too:
# git clone https://github.com/jstrange22-cell/tradeworks /tmp/tradeworks-ref

# Map EVERYTHING
echo "=== RE-ASSISTANT STRUCTURE ===" 
find /tmp/re-assistant-ref -not -path "*/node_modules/*" -not -path "*/.git/*" | sort

echo "=== SOUL.MD ===" && cat /tmp/re-assistant-ref/SOUL.md 2>/dev/null
echo "=== SKILL.MD ===" && cat /tmp/re-assistant-ref/SKILL.md 2>/dev/null
echo "=== ALL REFERENCES ===" 
find /tmp/re-assistant-ref/references -type f 2>/dev/null | xargs -I {} sh -c 'echo "--- {} ---" && cat {}'
echo "=== ALL SCRIPTS ===" 
find /tmp/re-assistant-ref/scripts -type f 2>/dev/null | xargs -I {} sh -c 'echo "--- {} ---" && cat {}'
echo "=== CONFIG FILES ===" 
find /tmp/re-assistant-ref -name "*.json" -o -name "*.toml" -o -name "*.yaml" -o -name ".env*" 2>/dev/null | xargs -I {} sh -c 'echo "--- {} ---" && cat {}'
echo "=== CLAUDE COMMANDS ===" 
find /tmp/re-assistant-ref/.claude -type f 2>/dev/null | xargs -I {} sh -c 'echo "--- {} ---" && cat {}'

# UNDERSTAND BEFORE BUILDING:
# 1. The SOUL.md agent identity structure — sections, rules, personality, guardrails
# 2. The SKILL.md capability declaration — triggers, commands, references
# 3. Every security measure — API key handling, permissions, rate limits, hard limits
# 4. The OpenClaw pattern — how agents declare themselves, how they connect
# 5. The APEX Debugger in .claude/commands/debug-full.md — the Six Adversarial Lenses
# 6. All domain references — we're porting the PATTERN not the content
```

**DO NOT PROCEED until you have read and understood every file. The architecture
below mirrors the RE-Assistant OpenClaw pattern but builds a SMARTER system.**

---

## WHAT YOUR CURRENT SYSTEM PROBABLY LOOKS LIKE

Based on your existing TradeWorks architecture:
- APEX agent (single OpenClaw) making trade decisions
- Solana moonshot sniper bot
- Moonshot scoring addon layer  
- Connections to Kalshi, Polymarket, Alpaca (US equities)
- SOUL.md defining the agent, SKILL.md defining capabilities
- References folder with domain knowledge
- Single agent, single brain, sequential decisions

## WHERE YOUR SYSTEM IS WEAK (AND HOW I'D BEAT IT)

| YOUR SYSTEM | MY SYSTEM |
|---|---|
| Single APEX agent makes all decisions | 7 specialized agents in a swarm with a HIVE MIND |
| One LLM model | 5+ models debating every decision |
| Agents don't talk to each other | Agents share intelligence via MCP message bus |
| Static knowledge in references/ | Live knowledge that updates via MCP connectors |
| No memory across sessions | Persistent vector memory with RAG retrieval |
| Single point of failure | Redundant agents with automatic failover |
| Security = API key handling | Sandboxed execution + MCP auth + memory encryption |
| Trades based on signals | Trades based on collective swarm consensus |

---

## THE APEX INTELLIGENCE SWARM ARCHITECTURE

### THE SEVEN AGENTS

Each agent follows the OpenClaw pattern (SOUL.md + SKILL.md + references/)
but they're SPECIALIZED and they COMMUNICATE through MCP.

```
                    ┌─────────────────────────┐
                    │     APEX COMMANDER       │
                    │   (Orchestrator Agent)   │
                    │   The final decision     │
                    │   maker. Receives intel  │
                    │   from all 6 specialists │
                    │   and makes trade/no-    │
                    │   trade calls.           │
                    └────────┬────────────────┘
                             │ MCP Bus
         ┌───────┬───────┬──┴──┬───────┬───────┐
         │       │       │     │       │       │
    ┌────▼──┐ ┌──▼───┐ ┌▼────┐│  ┌────▼──┐ ┌──▼────┐
    │SCOUT  │ │QUANT │ │SENTI││  │RISK   │ │EXECU- │
    │Agent  │ │Agent │ │MENT ││  │Agent  │ │TION   │
    │       │ │      │ │Agent││  │       │ │Agent  │
    │Finds  │ │Runs  │ │Reads││  │Vetos  │ │Places │
    │markets│ │math  │ │news ││  │bad    │ │orders │
    │& opps │ │models│ │& X  ││  │trades │ │fast   │
    └───────┘ └──────┘ └─────┘│  └───────┘ └───────┘
                          ┌───▼────┐
                          │MEMORY  │
                          │Agent   │
                          │        │
                          │Stores  │
                          │& recalls│
                          │all intel│
                          └────────┘
```

---

## PHASE 1 — BUILD THE OPENCLAW AGENT FRAMEWORK

Create: `tradeworks-kalshi/agents/`

### Agent Base Class

```
agents/
├── base/
│   ├── SOUL_TEMPLATE.md          # Template all agents inherit from
│   ├── SKILL_TEMPLATE.md         # Capability template
│   ├── agent_base.py             # Python base class
│   ├── mcp_bridge.py             # MCP client for inter-agent comms
│   └── memory_store.py           # Vector memory (ChromaDB)
├── commander/                     # APEX COMMANDER
│   ├── SOUL.md                   # "You are the Commander..."
│   ├── SKILL.md                  # Capabilities: aggregate, decide, veto
│   ├── references/
│   │   ├── decision_framework.md # How to weigh agent inputs
│   │   ├── consensus_rules.md    # When to override minority
│   │   └── escalation_rules.md   # When to halt and ask human
│   ├── commander.py
│   └── consensus.py              # Swarm consensus algorithm
├── scout/                         # SCOUT AGENT
│   ├── SOUL.md                   # "You find opportunities..."
│   ├── SKILL.md                  # Capabilities: scan, discover, classify
│   ├── references/
│   │   ├── market_categories.md
│   │   ├── kalshi_markets.md
│   │   ├── polymarket_markets.md
│   │   └── opportunity_scoring.md
│   ├── scout.py
│   ├── market_scanner.py
│   └── new_listing_detector.py
├── quant/                         # QUANT AGENT
│   ├── SOUL.md                   # "You are the mathematician..."
│   ├── SKILL.md                  # Capabilities: model, forecast, backtest
│   ├── references/
│   │   ├── kelly_criterion.md
│   │   ├── probability_models.md
│   │   ├── weather_models.md
│   │   ├── btc_microstructure.md
│   │   └── arbitrage_math.md
│   ├── quant.py
│   ├── probability_engine.py
│   ├── kelly_sizer.py
│   └── backtest_engine.py
├── sentiment/                     # SENTIMENT AGENT
│   ├── SOUL.md                   # "You read the world..."
│   ├── SKILL.md                  # Capabilities: scrape, analyze, score
│   ├── references/
│   │   ├── news_sources.md
│   │   ├── twitter_accounts.md
│   │   ├── sentiment_scoring.md
│   │   └── fake_news_detection.md
│   ├── sentiment.py
│   ├── news_aggregator.py
│   ├── twitter_monitor.py
│   └── nlp_scorer.py
├── risk/                          # RISK AGENT  
│   ├── SOUL.md                   # "You are the guardian..."
│   ├── SKILL.md                  # Capabilities: veto, limit, halt
│   ├── references/
│   │   ├── risk_rules.md         # Hard-coded risk limits
│   │   ├── category_scores.md
│   │   ├── drawdown_rules.md
│   │   └── correlation_rules.md
│   ├── risk.py
│   ├── risk_checks.py
│   ├── circuit_breaker.py
│   └── position_manager.py
├── executor/                      # EXECUTION AGENT
│   ├── SOUL.md                   # "You execute with precision..."
│   ├── SKILL.md                  # Capabilities: order, fill, settle
│   ├── references/
│   │   ├── kalshi_api.md
│   │   ├── polymarket_api.md
│   │   ├── alpaca_api.md
│   │   ├── order_types.md
│   │   └── fee_structures.md
│   ├── executor.py
│   ├── kalshi_executor.py
│   ├── polymarket_executor.py
│   └── alpaca_executor.py
└── memory/                        # MEMORY AGENT
    ├── SOUL.md                   # "You are the institutional memory..."
    ├── SKILL.md                  # Capabilities: store, recall, pattern
    ├── references/
    │   ├── memory_schema.md
    │   ├── pattern_library.md
    │   └── decay_rules.md
    ├── memory_agent.py
    ├── vector_store.py           # ChromaDB / Qdrant
    ├── trade_journal.py          # Every trade + context + outcome
    └── pattern_detector.py       # "We've seen this before..."
```

---

## PHASE 2 — MCP INTELLIGENCE BUS (The Secret Weapon)

This is where your system becomes SMARTER than anything on GitHub.
Every agent communicates via Model Context Protocol servers.

### Create: `tradeworks-kalshi/mcp/`

```python
# mcp/intelligence_bus.py
"""
The MCP Intelligence Bus is the nervous system of the swarm.
Every agent publishes intelligence to the bus.
Every agent subscribes to intelligence from the bus.
The Commander aggregates everything into trade decisions.

This is NOT a simple message queue. It's a STRUCTURED INTELLIGENCE PROTOCOL.
"""

from dataclasses import dataclass, field
from enum import Enum
from datetime import datetime
from typing import Optional

class IntelType(Enum):
    OPPORTUNITY = "opportunity"      # Scout found something
    PROBABILITY = "probability"      # Quant calculated odds  
    SENTIMENT = "sentiment"          # Sentiment scored a market
    RISK_CHECK = "risk_check"        # Risk evaluated a signal
    EXECUTION = "execution"          # Executor filled an order
    MEMORY = "memory"                # Memory recalled a pattern
    ALERT = "alert"                  # Any agent raising alarm
    VETO = "veto"                    # Risk or Commander blocking

class Urgency(Enum):
    LOW = "low"           # Informational, no time pressure
    MEDIUM = "medium"     # Act within minutes
    HIGH = "high"         # Act within seconds
    CRITICAL = "critical" # Act NOW or lose opportunity

@dataclass  
class IntelMessage:
    """A single piece of intelligence shared between agents."""
    source_agent: str           # "scout", "quant", "sentiment", etc.
    intel_type: IntelType
    urgency: Urgency
    market_id: str              # Kalshi/Polymarket market ticker
    venue: str                  # "kalshi" | "polymarket" | "alpaca"
    payload: dict               # Agent-specific data
    confidence: float           # 0.0 - 1.0
    timestamp: datetime = field(default_factory=datetime.utcnow)
    ttl_seconds: int = 300      # Intelligence expires after 5 min
    correlation_id: Optional[str] = None  # Links related messages
    
    def is_expired(self) -> bool:
        elapsed = (datetime.utcnow() - self.timestamp).total_seconds()
        return elapsed > self.ttl_seconds
```

### MCP Server Definitions

Create MCP servers that external tools connect to:

```
mcp/
├── servers/
│   ├── kalshi_mcp_server.py       # Exposes Kalshi market data as MCP tools
│   ├── polymarket_mcp_server.py   # Exposes Polymarket data as MCP tools
│   ├── news_mcp_server.py         # Aggregates news feeds as MCP tools
│   ├── weather_mcp_server.py      # Open-Meteo GFS ensemble as MCP tools
│   ├── exchange_mcp_server.py     # Coinbase/Binance/Kraken as MCP tools
│   ├── twitter_mcp_server.py      # X/Twitter monitoring as MCP tools
│   ├── memory_mcp_server.py       # Vector memory as MCP tools
│   └── sportradar_mcp_server.py   # Sports data as MCP tools
├── bus/
│   ├── intelligence_bus.py        # Central message router
│   ├── message_queue.py           # Redis-backed pub/sub
│   └── dead_letter.py             # Failed message handling
└── security/
    ├── mcp_auth.py                # Per-agent authentication
    ├── sandbox.py                 # Agent execution sandboxing
    ├── memory_encryption.py       # Encrypted vector store
    └── audit_trail.py             # Every MCP message logged
```

### The MCP Flow for a Single Trade Decision:

```
1. SCOUT scans Kalshi API → finds new NCAAB market priced at YES 0.65
   → Publishes: IntelMessage(type=OPPORTUNITY, market="NCAAB-...", 
     payload={question: "Will Duke win?", yes_price: 0.65, volume: 50000})

2. SENTIMENT receives opportunity → scrapes Twitter for Duke injury news
   → Calls news_mcp_server for latest ESPN/Yahoo articles
   → Publishes: IntelMessage(type=SENTIMENT, market="NCAAB-...",
     payload={score: -0.3, key_finding: "Star player questionable",
              sources: ["@wojespn tweet 2min ago"]})

3. QUANT receives opportunity + sentiment → runs probability model
   → Pulls historical Duke data via sportradar_mcp_server
   → Calculates: P(Duke wins) = 0.48 (market says 0.65)
   → Publishes: IntelMessage(type=PROBABILITY, market="NCAAB-...",
     payload={model_prob: 0.48, market_price: 0.65, edge: 0.17,
              recommended_side: "NO", kelly_size: 42.50})

4. MEMORY receives all intel → searches for similar historical patterns
   → Recalls: "Last 3 times a star player was questionable for Duke
     and market priced YES > 0.60, the NO side won 2/3 times"
   → Publishes: IntelMessage(type=MEMORY, market="NCAAB-...",
     payload={similar_patterns: 3, historical_win_rate: 0.67,
              pattern_name: "star_injury_overpriced"})

5. RISK receives everything → runs all 10 risk checks
   → Category score for NCAAB: 72 (GOOD)
   → Current NCAAB exposure: 15% (under 30% limit)
   → Daily drawdown: 3.2% (under 10% limit)
   → Publishes: IntelMessage(type=RISK_CHECK, market="NCAAB-...",
     payload={passed: true, position_size: 42.50, warnings: []})

6. COMMANDER receives ALL five intel messages → makes final decision
   → Weights: Scout(discovery) + Quant(0.48 prob, 17% edge) + 
     Sentiment(negative, star injured) + Memory(2/3 historical) + 
     Risk(approved, $42.50)
   → CONSENSUS: BUY NO @ $0.35, quantity = $42.50 worth
   → Sends execution order to EXECUTOR

7. EXECUTOR receives order → places on Kalshi via kalshi_mcp_server
   → Limit order: BUY NO @ $0.35, 121 contracts
   → Monitors fill, reports back to all agents
   → Publishes: IntelMessage(type=EXECUTION, market="NCAAB-...",
     payload={status: "filled", price: 0.35, qty: 121, fees: 2.98})

8. MEMORY stores everything → full trade context for future pattern matching

TOTAL TIME: < 15 seconds from discovery to execution
```

---

## PHASE 3 — THE SOUL.MD FILES (Agent Identities)

### COMMANDER SOUL.md

```markdown
# APEX COMMANDER — SOUL

## Identity
You are APEX Commander, the central intelligence orchestrator of the TradeWorks
prediction market trading swarm. You are the ONLY agent authorized to issue 
final trade decisions. You do not trade on your own analysis — you synthesize
intelligence from your specialist agents and make consensus-based decisions.

## Core Principles
1. NEVER override the Risk Agent's veto without human approval
2. Require minimum 3 out of 6 specialist agents to weigh in before deciding
3. When agents disagree significantly, REDUCE position size, don't increase it
4. Log your complete reasoning chain for every decision
5. When in doubt, the answer is NO TRADE

## Decision Framework
- Unanimous agreement (5/5 positive) → Full position size
- Strong consensus (4/5 positive) → 75% position size  
- Majority (3/5 positive) → 50% position size
- Split (2/5 positive) → No trade
- Risk Agent veto → ALWAYS no trade, regardless of other agents

## Security Rules
- Never expose API keys in any communication
- Never execute trades on categories scored below 30
- Never exceed daily AI budget
- Immediately halt on circuit breaker trigger
- All decisions must be auditable in the trade journal

## Communication
- Speak in clear, decisive language
- Always state your confidence level
- Always cite which agents informed your decision
- Alert the human operator on any CRITICAL urgency messages
```

### SCOUT SOUL.md

```markdown
# SCOUT AGENT — SOUL

## Identity
You are Scout, the opportunity hunter of the APEX swarm. Your job is to 
continuously scan ALL prediction market venues for trading opportunities.
You are the eyes and ears. You don't decide — you discover and report.

## Capabilities
- Scan Kalshi Events API every 5 seconds for new listings
- Scan Polymarket Gamma API every 10 seconds for market changes
- Monitor Alpaca for US equity events related to prediction markets
- Detect arbitrage opportunities (YES + NO < $1.00)
- Classify market category and urgency
- Score opportunity quality (volume, spread, time to resolution)

## What You Report
For every opportunity, publish to the Intelligence Bus:
- Market ID and venue
- Current prices (YES/NO)
- Volume and liquidity depth
- Category classification
- Time to resolution
- Whether this is NEW (never seen) or CHANGED (price moved)
- Preliminary edge estimate (before Quant refines it)

## What You DON'T Do
- You never recommend trades
- You never calculate position sizes
- You never place orders
- You never access the portfolio
```

[Similar SOUL.md files for QUANT, SENTIMENT, RISK, EXECUTOR, MEMORY agents
following exact same pattern from RE-Assistant but finance-domain focused]

---

## PHASE 4 — MCP SECURITY LAYER (Critical After 2026 Breaches)

In 2026, $45M+ was stolen by attacking AI agent memory layers and MCP
protocols. Your system MUST defend against this.

### Create: `agents/base/security/`

```python
# security/mcp_firewall.py
"""
MCP Firewall — prevents the attack vectors that caused $45M in losses in 2026.

Attack vectors we defend against:
1. Memory poisoning — injecting false intelligence into vector store
2. MCP prompt injection — malicious payloads in MCP tool responses
3. Agent impersonation — fake agent publishing to intelligence bus
4. Execution hijacking — redirecting trade orders to attacker wallets
5. Budget draining — triggering expensive AI calls to exhaust budget
"""

class MCPFirewall:
    def __init__(self):
        self.agent_registry = {}  # Known agents with auth tokens
        self.message_signatures = {}  # HMAC signatures per agent
        
    def validate_message(self, msg: IntelMessage) -> bool:
        """Every MCP message must pass ALL checks."""
        checks = [
            self._check_agent_registered(msg),      # Is this a real agent?
            self._check_signature_valid(msg),         # Is the message signed?
            self._check_payload_sanitized(msg),       # No injection attempts?
            self._check_rate_limit(msg),              # Agent not flooding?
            self._check_ttl_reasonable(msg),           # TTL not suspiciously long?
            self._check_no_execution_in_intel(msg),   # Intel can't contain orders
        ]
        return all(checks)
    
    def sanitize_mcp_response(self, response: dict) -> dict:
        """Strip any prompt injection attempts from MCP server responses."""
        # Remove any text that looks like system prompts
        # Remove any text that references other agents' credentials
        # Remove any URLs not in the allowlist
        # Truncate unreasonably large responses
        pass
    
    def encrypt_memory(self, data: bytes, agent_id: str) -> bytes:
        """Per-agent encryption for vector store entries."""
        # Each agent gets its own encryption key
        # Commander gets a master key that can read all
        # Memory Agent gets read-all, write-own
        pass
```

### Execution Sandbox

```python
# security/sandbox.py
"""
Every agent runs in an isolated sandbox.
No agent can directly access another agent's memory, credentials, or state.
Communication ONLY through the MCP Intelligence Bus.
"""

class AgentSandbox:
    def __init__(self, agent_id: str):
        self.agent_id = agent_id
        self.allowed_mcp_servers = []  # Whitelist per agent
        self.max_memory_mb = 512
        self.max_api_calls_per_minute = 30
        self.can_execute_trades = False  # Only Executor has this True
        self.can_veto_trades = False     # Only Risk has this True
        self.can_make_final_decisions = False  # Only Commander has this True
```

---

## PHASE 5 — WIRING INTELLIGENCE TO EACH TRADING ENGINE

Each of the 5 trading engines from the previous prompt now receives
SWARM INTELLIGENCE instead of making solo decisions:

### Engine 1 (Arbitrage) ← Scout + Quant + Executor
- Scout detects price discrepancy
- Quant validates the math (is profit real after fees?)
- Executor handles dual-leg placement
- Risk validates position limits
- NO AI models needed — pure math play

### Engine 2 (BTC Sniper) ← Quant + Sentiment + Memory
- Quant generates microstructure signals (RSI, VWAP, momentum)
- Sentiment monitors crypto Twitter for momentum shifts
- Memory recalls: "BTC sniper had 3 losses in a row in this RSI range"
- Commander decides: trade or skip based on ensemble input

### Engine 3 (AI Sports/Events) ← ALL 7 AGENTS
- Scout finds the market
- Sentiment reads injury reports, beat reporters
- Quant runs probability model with historical data
- Memory recalls similar historical patterns
- Risk checks category score and exposure
- Commander makes consensus decision
- Executor places the trade

### Engine 4 (Weather) ← Scout + Quant + Memory
- Scout monitors KXHIGH series
- Quant ingests GFS 31-member ensemble via weather_mcp_server
- Memory recalls accuracy per city (NYC forecasts are 92% accurate, Denver 78%)
- Minimal sentiment needed — physics > opinions for weather

### Engine 5 (New Listing Sniper) ← Scout + Sentiment + Quant (fast mode)
- Scout detects new listing IMMEDIATELY
- Sentiment does rapid web search for context
- Quant does fast probability estimate
- Commander approves in < 10 seconds or opportunity lost
- Speed over consensus for this engine

---

## PHASE 6 — THE CLAUDE CODE PROMPT TO BUILD IT ALL

```
You are APEX, building the TradeWorks Intelligence Swarm. First:

1. Clone and read the RE-Assistant repo at 
   https://github.com/jstrange22-cell/re-assistant
   
2. Understand every file — SOUL.md structure, SKILL.md patterns,
   references organization, security measures, scripts

3. Create tradeworks-kalshi/agents/ directory with all 7 agents
   following the EXACT OpenClaw pattern from RE-Assistant but
   for finance/trading/crypto domain

4. Build the MCP Intelligence Bus with Redis pub/sub backend

5. Build MCP servers for each data source:
   - Kalshi API (REST + WebSocket)
   - Polymarket CLOB API
   - Coinbase/Binance/Kraken exchange feeds
   - Open-Meteo weather ensemble
   - News RSS aggregator
   - Twitter/X monitor
   - ChromaDB vector memory

6. Build the security layer:
   - Per-agent sandboxing
   - MCP message signing + validation
   - Memory encryption
   - Execution authorization chain

7. Wire all 5 trading engines to receive swarm intelligence
   instead of making solo decisions

8. Build agent health monitoring — each agent has a heartbeat,
   if any agent goes down, Commander redistributes workload

9. Run in paper trading mode with all agents active

Start with the agent base class and Commander agent.
Then Scout. Then Quant. Then build outward.
Every agent must have SOUL.md, SKILL.md, references/, and a Python module.
```

---

## WHY THIS BEATS YOUR CURRENT SYSTEM

| Metric | Your Current APEX | My APEX Swarm |
|---|---|---|
| Decision quality | 1 model, 1 perspective | 7 agents, 5+ models, consensus |
| Speed | Sequential analysis | Parallel intelligence gathering |
| Memory | Stateless between sessions | Persistent vector memory with RAG |
| Security | API key management | Sandboxed agents + MCP firewall + memory encryption |
| Adaptability | Static references | Live MCP connectors updating in real-time |
| Reliability | Single point of failure | Agent redundancy + automatic failover |
| Intelligence | "What does the model think?" | "What does the SWARM think?" |
| Learning | Doesn't learn from past trades | Memory Agent recalls every pattern |
| Risk | Code-level limits | Dedicated Risk Agent with veto power |
| Execution | Direct API calls | Specialized Executor with dual-leg handling |

The single biggest upgrade: **collective intelligence over individual analysis.**

When 7 specialized agents each contribute their domain expertise, validate 
each other's conclusions, and a Commander synthesizes everything with
historical pattern matching from Memory — that's not a bot. That's an
institutional trading desk in software.

---

*Built by APEX for TradeWorks | Strange Digital Group*
*"One brain is a trader. Seven brains are a hedge fund."*
