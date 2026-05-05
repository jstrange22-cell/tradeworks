"""Strategy B5: Funding-Rate Cash-and-Carry Basis Trade.

Delta-neutral basis: long spot crypto + short the corresponding perpetual future
to collect the periodic funding payment. Edge is the funding rate; market risk is
~zero by construction (long spot offsets short perp 1:1).

References (see README.md): cash-and-carry on FX futures (Hull, *Options, Futures
and Other Derivatives*); Skew/Galaxy/Pantera periodic perp-funding research; FTX
basis-fund disclosures (pre-collapse).

Phase: research scaffold. FreqTrade port deferred — see README.
"""

from __future__ import annotations
