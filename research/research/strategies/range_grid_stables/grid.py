"""Grid orderbook for the stablecoin range-grid strategy.

A :class:`GridOrderbook` maintains a symmetric ladder of resting bids and asks
around an anchor price. When a tick crosses a rung, that rung fills and a
replacement is placed on the **opposite** side at the symmetric level — so a
buy at 0.9985 gets re-listed as a sell at 0.9995 (one spacing notch up).

Inventory caps
--------------
The ``max_inventory_quote`` parameter caps how much net long inventory the
book can accumulate. When the cap is hit:

- Further BUY fills are skipped (rung remains resting; price walked through
  it but the order behaves as if it would have been cancelled by the trader's
  inventory-aware cancel-on-fill logic).
- SELL fills always proceed because they reduce inventory.

This matches the spec: *"Cap concurrent inventory at +/- 50% of allocated
capital (avoids unbounded one-sided drift exposure)."*

Notes
-----
- Prices stored as floats; tiny absolute tolerance for crossings.
- Each rung has a fixed quote-currency notional (``order_size_quote``).
- Open inventory tracked as FIFO ``(buy_price, quote_notional)`` lots.
- Fees charged per fill using the configured maker/taker mix.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from typing import Deque

from research.strategies.range_grid_stables.signal import (
    GridOrder,
    OrderSide,
)

# Re-export OrderSide so legacy importers (tests, simulator) still find it
# at ``grid.OrderSide``.
__all__ = ["FillEvent", "GridOrderbook", "OrderSide", "Rung"]


@dataclass(frozen=True)
class Rung:
    """A single resting limit order on the grid.

    ``level`` is signed: negative levels sit below the anchor (buys), positive
    levels sit above (sells).
    """

    level: int
    side: OrderSide
    price: float
    quote_notional: float


@dataclass
class FillEvent:
    """Record of a single rung fill, used for P&L accounting and reporting.

    ``realized_pnl_quote`` is non-zero only on the closing leg of a round-trip
    (the SELL that closes a previously-opened BUY lot).
    """

    timestamp_idx: int
    side: OrderSide
    price: float
    quote_notional: float
    base_qty: float
    fee_quote: float
    realized_pnl_quote: float = 0.0


@dataclass
class GridOrderbook:
    """Symmetric grid of resting limit orders around a moving anchor price.

    Pure: no I/O, no time concept, no notion of an exchange. The simulator
    drives it tick-by-tick.
    """

    anchor_price: float
    levels_above: int
    levels_below: int
    spacing_bps: float
    order_size_quote: float
    maker_fee_bps: float
    taker_fee_bps: float
    maker_taker_mix: float
    # Cap on total open BUY-side inventory (quote currency at *cost basis*).
    # ``None`` -> no cap.
    max_inventory_quote: float | None = None

    rungs: dict[int, Rung] = field(default_factory=dict)
    # FIFO queue of open buy lots: (entry_price, quote_notional_at_entry).
    open_buy_lots: Deque[tuple[float, float]] = field(default_factory=deque)
    fills: list[FillEvent] = field(default_factory=list)
    # Counters surfaced for tests / introspection.
    skipped_buys_for_cap: int = 0

    # ---- construction --------------------------------------------------- #

    def __post_init__(self) -> None:
        self._validate()

    def _validate(self) -> None:
        if self.levels_above <= 0 or self.levels_below <= 0:
            raise ValueError("levels_above and levels_below must be positive")
        if self.spacing_bps <= 0:
            raise ValueError("spacing_bps must be positive")
        if self.order_size_quote <= 0:
            raise ValueError("order_size_quote must be positive")
        if not 0.0 <= self.maker_taker_mix <= 1.0:
            raise ValueError("maker_taker_mix must be in [0, 1]")
        if self.max_inventory_quote is not None and self.max_inventory_quote < 0.0:
            raise ValueError("max_inventory_quote must be non-negative or None")

    # ---- public API ---------------------------------------------------- #

    def place_grid(self, new_anchor: float, *, place_sells: bool | None = None) -> None:
        """Reset the BUY ladder around ``new_anchor`` and refresh SELL rungs.

        Open inventory (``open_buy_lots``) is preserved. Existing SELL rungs
        are *kept* (they target specific lots at specific exit prices and
        moving them on every refresh would defeat the purpose); only BUY
        rungs are re-quoted around the new anchor. New SELL rungs are
        placed for any open lots that don't yet have a corresponding sell
        rung in the book.

        Parameters
        ----------
        new_anchor:
            Anchor price for the new BUY ladder.
        place_sells:
            If ``None`` (default), keep existing SELL rungs and add new ones
            for un-quoted lots. If ``True``, replace ALL rungs with a fresh
            symmetric ladder (legacy unconditional placement; used by tests).
            If ``False``, place no SELL rungs at all.
        """
        if new_anchor <= 0:
            raise ValueError("anchor must be positive")
        spacing = self.spacing_bps / 10_000.0

        if place_sells is True:
            # Legacy unconditional symmetric placement.
            self.anchor_price = new_anchor
            self.rungs = {}
            for k in range(1, self.levels_below + 1):
                price = new_anchor * (1.0 - k * spacing)
                self.rungs[-k] = Rung(-k, OrderSide.BUY, price, self.order_size_quote)
            for k in range(1, self.levels_above + 1):
                price = new_anchor * (1.0 + k * spacing)
                self.rungs[k] = Rung(k, OrderSide.SELL, price, self.order_size_quote)
            return

        # ---- partial refresh: BUY ladder + missing SELL rungs only ---- #
        # Cancel only BUY rungs (sells are kept in place to honor lot exits).
        self.rungs = {
            level: rung for level, rung in self.rungs.items() if rung.side is OrderSide.SELL
        }
        self.anchor_price = new_anchor
        # Re-place full BUY ladder at new prices.
        for k in range(1, self.levels_below + 1):
            price = new_anchor * (1.0 - k * spacing)
            self.rungs[-k] = Rung(-k, OrderSide.BUY, price, self.order_size_quote)

        if place_sells is False:
            return

        # Lay new SELL rungs for any open lots that don't yet have one queued.
        existing_sells = sum(1 for r in self.rungs.values() if r.side is OrderSide.SELL)
        n_lots = len(self.open_buy_lots)
        n_needed = max(0, n_lots - existing_sells)
        # Place at the next free positive level above the anchor.
        next_level = 1
        for _ in range(n_needed):
            while next_level in self.rungs and next_level <= self.levels_above:
                next_level += 1
            if next_level > self.levels_above:
                break  # no slots left
            price = new_anchor * (1.0 + next_level * spacing)
            self.rungs[next_level] = Rung(
                next_level, OrderSide.SELL, price, self.order_size_quote
            )
            next_level += 1

    def place_grid_from_orders(self, orders: list[GridOrder]) -> None:
        """Place a grid directly from a list of :class:`GridOrder` specs.

        Useful when the grid layout is computed externally (e.g. by
        :func:`signal.generate_grid`) and we want the orderbook to honor the
        exact prices/notionals returned. Anchor is inferred as the geometric
        midpoint of (min sell, max buy) so subsequent crossings still align.
        """
        if not orders:
            raise ValueError("orders must be non-empty")
        self.rungs = {}
        for o in orders:
            self.rungs[o.level] = Rung(
                level=o.level,
                side=o.side,
                price=o.price,
                quote_notional=o.notional_quote,
            )
        # Recover anchor from levels: price = anchor * (1 + level * spacing/1e4).
        spacing = self.spacing_bps / 10_000.0
        # Pick the first BUY rung to back-solve.
        for o in orders:
            if o.side is OrderSide.BUY:
                inferred = o.price / (1.0 + o.level * spacing)
                if inferred > 0.0:
                    self.anchor_price = inferred
                    break

    def crossings(self, prev_price: float, current_price: float) -> list[int]:
        """Return the levels (in fill-order) that the price crossed.

        A buy rung at price ``p`` fills when the tick traverses ``p`` from above
        (``prev > p >= current``); a sell fills when the tick traverses ``p``
        from below (``prev < p <= current``).
        """
        hits: list[tuple[float, int]] = []
        for level, rung in self.rungs.items():
            if rung.side is OrderSide.BUY:
                if prev_price > rung.price >= current_price:
                    hits.append((prev_price - rung.price, level))
            else:  # SELL
                if prev_price < rung.price <= current_price:
                    hits.append((rung.price - prev_price, level))
        hits.sort()  # nearest crossings fill first as the tick moves
        return [lvl for _, lvl in hits]

    def fill_event_handler(
        self,
        level: int,
        timestamp_idx: int,
    ) -> FillEvent | None:
        """Process a fill at ``level``: book P&L, replace order on opposite side.

        Returns the recorded :class:`FillEvent`, or ``None`` if the fill was
        suppressed by the inventory cap (BUY only).
        """
        rung = self.rungs.get(level)
        if rung is None:
            raise KeyError(f"no rung at level {level}")

        # Inventory cap check (BUY side only — sells reduce exposure).
        if (
            rung.side is OrderSide.BUY
            and self.max_inventory_quote is not None
            and self.open_inventory_cost() + rung.quote_notional > self.max_inventory_quote
        ):
            self.skipped_buys_for_cap += 1
            return None  # rung stays in the book; trader holds back the fill

        # SELL with no inventory: cancel the rung silently. This is a defensive
        # check that backs up the place_grid policy of only quoting sells
        # against open inventory — if anything ever desyncs (e.g. a stale
        # placement from a prior grid that wasn't cleaned up) we don't book
        # phantom realized P&L on a non-existent position.
        if rung.side is OrderSide.SELL and not self.open_buy_lots:
            self.rungs.pop(level)
            return None

        # We've committed to processing this fill — pop the rung.
        self.rungs.pop(level)

        # Effective fee = maker_fee * mix + taker_fee * (1 - mix).
        fee_bps = (
            self.maker_fee_bps * self.maker_taker_mix
            + self.taker_fee_bps * (1.0 - self.maker_taker_mix)
        )
        fee_frac = fee_bps / 10_000.0
        fee_quote = rung.quote_notional * fee_frac

        base_qty = rung.quote_notional / rung.price
        realized = 0.0

        if rung.side is OrderSide.BUY:
            self.open_buy_lots.append((rung.price, rung.quote_notional))
            self._replace_with_opposite(level)
        else:  # SELL — close the oldest open lot
            realized = self._close_oldest_lot(sell_price=rung.price)
            self._replace_with_opposite(level)

        event = FillEvent(
            timestamp_idx=timestamp_idx,
            side=rung.side,
            price=rung.price,
            quote_notional=rung.quote_notional,
            base_qty=base_qty,
            fee_quote=fee_quote,
            realized_pnl_quote=realized,
        )
        self.fills.append(event)
        return event

    # ---- internals ----------------------------------------------------- #

    def _replace_with_opposite(self, filled_level: int) -> None:
        """Place a replacement rung one notch on the opposite side.

        A buy at level ``-k`` becomes a sell at level ``-k+1``. A sell at level
        ``+k`` becomes a buy at level ``+k-1``. The anchor (level 0) is never
        quoted so a fill at level -1 / +1 produces no replacement.
        """
        spacing = self.spacing_bps / 10_000.0
        if filled_level < 0:
            new_level = filled_level + 1
            new_side = OrderSide.SELL
        else:
            new_level = filled_level - 1
            new_side = OrderSide.BUY
        if new_level == 0:
            return
        new_price = self.anchor_price * (1.0 + new_level * spacing)
        self.rungs[new_level] = Rung(new_level, new_side, new_price, self.order_size_quote)

    def _close_oldest_lot(self, sell_price: float) -> float:
        """Pop the oldest open buy lot and return realized P&L (quote currency).

        Returns 0.0 if no open lot exists (this should rarely happen because
        the grid only places sell rungs after a buy fill has opened a lot).
        """
        if not self.open_buy_lots:
            return 0.0
        buy_price, buy_notional = self.open_buy_lots.popleft()
        base_qty = buy_notional / buy_price
        return (sell_price - buy_price) * base_qty

    # ---- introspection ------------------------------------------------- #

    def open_inventory_quote(self, mark_price: float) -> float:
        """Mark-to-market value of open buy lots in quote currency."""
        if not self.open_buy_lots:
            return 0.0
        total = 0.0
        for buy_price, notional in self.open_buy_lots:
            base_qty = notional / buy_price
            total += base_qty * mark_price
        return total

    def open_inventory_cost(self) -> float:
        """Total cost basis of open buy lots in quote currency."""
        return sum(notional for _, notional in self.open_buy_lots)

    def flatten(self, mark_price: float) -> float:
        """Cancel all rungs and unwind open inventory at ``mark_price``.

        Returns the cash recovered from selling the inventory at the mark
        (i.e. ``open_inventory_quote(mark_price)``). The simulator adds this
        to its cash balance.
        """
        cash_recovered = self.open_inventory_quote(mark_price)
        self.open_buy_lots.clear()
        self.rungs = {}
        return cash_recovered
