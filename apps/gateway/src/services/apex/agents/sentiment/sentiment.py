"""
APEX Sentiment Agent — Information Analyst
Reads news, social media, and data feeds. Converts raw information into structured
sentiment scores that inform trading decisions.
"""

from __future__ import annotations
import asyncio
import logging
import time
from datetime import datetime, timezone

from agents.base.agent_base import AgentBase
from shared.models import AgentRole, IntelType, IntelMessage, Urgency
from shared.config import AppConfig


class SentimentAgent(AgentBase):
    """Monitors news and social media, produces sentiment scores per market."""

    def _get_role(self) -> AgentRole:
        return AgentRole.SENTIMENT

    def __init__(self, config: AppConfig, bus):
        super().__init__(config, bus)
        self._subscriptions = [IntelType.OPPORTUNITY]
        self._rss_sources = [
            {"name": "ESPN", "url": "https://www.espn.com/espn/rss/news"},
            {"name": "AP Sports", "url": "https://rss.app/feeds/v1.1/tpMVvCpPrOL9DPGN.json"},
            {"name": "Reuters", "url": "https://www.reutersagency.com/feed/"},
        ]
        self._twitter_accounts = [
            "@ShamsCharania", "@wojespn", "@AdamSchefter",
            "@RapSheet", "@JonRothstein", "@JeffPassan",
        ]
        self._cache: dict[str, dict] = {}  # market_id → cached sentiment
        self._cache_ttl = 300  # 5 minutes

    async def on_startup(self):
        self.logger.info("Sentiment Agent online. Monitoring news and social feeds.")

    async def on_intel(self, message: IntelMessage):
        """When Scout finds an opportunity, analyze sentiment for that market."""
        if message.intel_type != IntelType.OPPORTUNITY:
            return

        market_id = message.market_id
        category = message.payload.get("category", "").upper()
        title = message.payload.get("title", "")

        # Check cache
        cached = self._cache.get(market_id)
        if cached and (time.time() - cached["timestamp"]) < self._cache_ttl:
            await self._publish_sentiment(message, cached)
            return

        # Skip sentiment for pure arb plays (math, not opinion)
        if message.payload.get("is_arbitrage"):
            return

        # Analyze based on category
        if category in ("NCAAB", "NBA", "NFL", "MLB", "NHL"):
            result = await self._analyze_sports(title, category)
        elif category == "CRYPTO_15M":
            result = await self._analyze_crypto(title)
        elif category in ("POLITICS", "ECON_MACRO"):
            result = await self._analyze_politics(title)
        elif category == "WEATHER":
            return  # Weather doesn't need sentiment — physics > opinions
        else:
            result = await self._analyze_general(title)

        if result:
            self._cache[market_id] = {**result, "timestamp": time.time()}
            await self._publish_sentiment(message, result)

    async def _publish_sentiment(self, orig_message: IntelMessage, result: dict):
        """Publish sentiment analysis to the bus."""
        await self.publish(
            intel_type=IntelType.SENTIMENT,
            market_id=orig_message.market_id,
            venue=orig_message.venue,
            payload={
                "sentiment_score": result.get("score", 0.0),
                "key_findings": result.get("findings", []),
                "sources": result.get("sources", []),
                "recency_hours": result.get("recency_hours", 24),
                "narrative_shift": result.get("narrative_shift", False),
                "summary": result.get("summary", ""),
            },
            confidence=result.get("confidence", 0.3),
            urgency=Urgency.HIGH if result.get("is_breaking") else Urgency.MEDIUM,
            correlation_id=orig_message.correlation_id,
        )

    # =========================================================================
    # ANALYSIS METHODS (implement with real APIs)
    # =========================================================================

    async def _analyze_sports(self, title: str, category: str) -> dict | None:
        """Analyze sports sentiment from news and Twitter."""
        findings = []
        sources = []

        # Step 1: Search RSS feeds for relevant articles
        articles = await self._search_rss(title)
        for article in articles[:5]:
            sentiment = self._score_text(article.get("summary", ""))
            findings.append({
                "source": article.get("source", "unknown"),
                "headline": article.get("title", ""),
                "sentiment": sentiment,
                "timestamp": article.get("published", ""),
            })
            sources.append(article.get("source", ""))

        # Step 2: Check Twitter for injury/lineup news
        tweets = await self._search_twitter(title, self._twitter_accounts)
        for tweet in tweets[:5]:
            sentiment = self._score_text(tweet.get("text", ""))
            is_injury = any(kw in tweet.get("text", "").lower()
                          for kw in ["injury", "out", "questionable", "doubtful", "dnp", "ruled out"])
            findings.append({
                "source": tweet.get("author", ""),
                "text": tweet.get("text", "")[:200],
                "sentiment": sentiment,
                "is_injury_report": is_injury,
                "timestamp": tweet.get("created_at", ""),
            })
            if is_injury:
                sources.append(f"INJURY: {tweet.get('author', '')}")

        if not findings:
            return None

        # Aggregate sentiment
        scores = [f["sentiment"] for f in findings if f.get("sentiment") is not None]
        avg_score = sum(scores) / len(scores) if scores else 0.0
        has_injury = any(f.get("is_injury_report") for f in findings)

        return {
            "score": avg_score,
            "findings": findings,
            "sources": sources,
            "confidence": min(0.8, 0.3 + len(findings) * 0.1),
            "recency_hours": 24,
            "is_breaking": has_injury,
            "narrative_shift": has_injury,
            "summary": f"{'INJURY ALERT: ' if has_injury else ''}Sentiment {avg_score:+.2f} from {len(findings)} sources",
        }

    async def _analyze_crypto(self, title: str) -> dict | None:
        """Analyze crypto sentiment — lightweight for 15-min markets."""
        # For 15-min crypto, sentiment is less useful than microstructure
        # But big news (exchange hack, regulation) can override technicals
        articles = await self._search_rss(title)
        if not articles:
            return {"score": 0.0, "confidence": 0.1, "findings": [], "sources": [],
                    "summary": "No significant crypto news"}

        scores = [self._score_text(a.get("summary", "")) for a in articles[:3]]
        avg = sum(scores) / len(scores) if scores else 0.0

        return {
            "score": avg,
            "confidence": 0.3,
            "findings": [{"headline": a.get("title", ""), "sentiment": s}
                        for a, s in zip(articles[:3], scores)],
            "sources": [a.get("source", "") for a in articles[:3]],
            "summary": f"Crypto sentiment {avg:+.2f}",
        }

    async def _analyze_politics(self, title: str) -> dict | None:
        """Analyze political sentiment from news sources."""
        articles = await self._search_rss(title)
        if not articles:
            return None

        scores = [self._score_text(a.get("summary", "")) for a in articles[:5]]
        avg = sum(scores) / len(scores) if scores else 0.0

        return {
            "score": avg,
            "confidence": 0.4,
            "findings": [{"headline": a.get("title", ""), "sentiment": s}
                        for a, s in zip(articles[:5], scores)],
            "sources": [a.get("source", "") for a in articles[:5]],
            "summary": f"Political sentiment {avg:+.2f} from {len(articles)} sources",
        }

    async def _analyze_general(self, title: str) -> dict | None:
        """Generic sentiment analysis for uncategorized markets."""
        return {"score": 0.0, "confidence": 0.1, "findings": [], "sources": [],
                "summary": "Insufficient data for sentiment analysis"}

    # =========================================================================
    # DATA SOURCE STUBS (replace with real implementations)
    # =========================================================================

    async def _search_rss(self, query: str) -> list[dict]:
        """Search RSS feeds for articles matching query. IMPLEMENT WITH REAL FEEDS."""
        # TODO: Use feedparser to fetch and search RSS feeds
        # TODO: Score relevance of each article to the query
        return []

    async def _search_twitter(self, query: str, accounts: list[str]) -> list[dict]:
        """Search Twitter/X for relevant tweets. IMPLEMENT WITH REAL API."""
        # TODO: Use Grok API (has X data access) or Twitter API v2
        # TODO: Filter by accounts list, recency, and relevance
        return []

    def _score_text(self, text: str) -> float:
        """Score text sentiment from -1.0 to +1.0. IMPLEMENT WITH NLP."""
        # TODO: Replace with real NLP sentiment scoring
        # Options: VADER, TextBlob, or LLM-based scoring via OpenRouter
        # For now: keyword-based heuristic
        if not text:
            return 0.0

        text_lower = text.lower()
        positive_keywords = ["win", "strong", "surge", "rally", "bullish", "positive",
                           "upgrade", "beat", "exceed", "healthy", "return"]
        negative_keywords = ["loss", "injury", "out", "questionable", "decline", "weak",
                           "bearish", "miss", "below", "concern", "suspend", "crash"]

        pos_count = sum(1 for kw in positive_keywords if kw in text_lower)
        neg_count = sum(1 for kw in negative_keywords if kw in text_lower)

        total = pos_count + neg_count
        if total == 0:
            return 0.0
        return (pos_count - neg_count) / total

    async def run_cycle(self):
        """Periodic background tasks — refresh RSS feeds, prune cache."""
        # Prune expired cache entries
        now = time.time()
        expired = [k for k, v in self._cache.items()
                   if now - v.get("timestamp", 0) > self._cache_ttl * 2]
        for k in expired:
            del self._cache[k]

        await asyncio.sleep(10.0)
