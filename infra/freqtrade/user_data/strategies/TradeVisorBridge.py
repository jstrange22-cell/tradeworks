"""
TradeVisorBridge — FreqTrade strategy that defers signal generation to the
TradeWorks gateway and just executes whatever the gateway tells it to.

The gateway receives TradeVisor signals via TradingView webhooks (or the
tv-bridge polling daemon) and forwards them to FreqTrade's REST API as
forceentry / forceexit calls. This strategy provides:

  - The pair_whitelist (CEX blue chips) FreqTrade trades on
  - Risk parameters (stoploss, ROI, max_open_trades) so even if the gateway
    sends bad signals, FreqTrade enforces position limits + drawdown caps
  - A neutral populate_*() that NEVER auto-enters — every trade comes from
    a force_entry pushed from the gateway

This is the v1 architecture for Phase 2 — keep the gateway as the single
signal source, let FreqTrade handle execution + risk + position management.
"""

from datetime import datetime
from typing import Optional

from freqtrade.strategy import IStrategy, IntParameter
from pandas import DataFrame


class TradeVisorBridge(IStrategy):
    INTERFACE_VERSION = 3

    # Risk caps that apply regardless of what signals come in.
    # Gateway can override per-trade via custom_stake_amount in force_entry,
    # but these are the floor.
    minimal_roi = {
        "0": 0.10,    # take any 10%+ gain immediately
        "60": 0.05,   # after 60 min, take 5%
        "240": 0.02,  # after 4h, take 2%
        "1440": 0     # after 24h, exit at break-even
    }

    stoploss = -0.05  # hard 5% stop — TradeVisor itself has no stop, we add one

    # Trailing stops kick in once a position is in profit.
    trailing_stop = True
    trailing_stop_positive = 0.02
    trailing_stop_positive_offset = 0.04
    trailing_only_offset_is_reached = True

    timeframe = "15m"
    process_only_new_candles = True

    use_exit_signal = False  # exits come from gateway force_exit, not strategy
    exit_profit_only = False
    ignore_roi_if_entry_signal = False

    startup_candle_count = 30  # we don't compute much, but keep some headroom

    # Allow the gateway to push entries via REST.
    # In config.json, force_entry_enable must be true.

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """No indicators needed — gateway is the signal source.

        Future improvement: compute a sanity-check signal here and reject
        gateway entries that disagree (e.g. gateway says BUY but our local
        EMA-trend says STRONG_DOWN). For v1 we trust the gateway.
        """
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """No automatic entries — only force_entry from gateway."""
        dataframe["enter_long"] = 0
        dataframe["enter_short"] = 0
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        """No automatic exits — risk handled by minimal_roi + stoploss."""
        dataframe["exit_long"] = 0
        dataframe["exit_short"] = 0
        return dataframe

    def custom_stake_amount(
        self,
        pair: str,
        current_time: datetime,
        current_rate: float,
        proposed_stake: float,
        min_stake: Optional[float],
        max_stake: float,
        leverage: float,
        entry_tag: Optional[str],
        side: str,
        **kwargs,
    ) -> float:
        """Per-grade sizing matching the stock-agent ladder:
            standard $100, strong $250, prime $500.

        Gateway encodes grade in the entry_tag (e.g. "tradevisor_strong").
        """
        if entry_tag == "tradevisor_prime":
            target = 500.0
        elif entry_tag == "tradevisor_strong":
            target = 250.0
        else:
            target = 100.0  # standard / unknown
        if min_stake is not None and target < min_stake:
            return min_stake
        if target > max_stake:
            return max_stake
        return target
