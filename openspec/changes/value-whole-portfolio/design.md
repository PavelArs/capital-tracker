## Context

Holdings are already reconstructed exactly by the connected FIFO replay
(`readConnectedLedger`, `projectConnectedLedger`, `projectHistoricalFifo`), which the
selected-account preview (`manual-portfolio-valuation`) uses at an exact instant with
exact-instant manual prices. M2 gave each instrument `assetType`, `valuationCurrency`
and `priceSource`; M3 stores market observations keyed by ticker (`price_observations`)
with the product's valuation rule "latest at or before t" and 2 hour freshness.

## Decisions

1. **New read, old previews untouched.** `GET /accounting/portfolio` is a separate
   endpoint. The selected-account preview, account valuation and history keep their
   exact-instant manual-price contract; their screens stay under Legacy.
2. **One component replay per connected group.** Every owner account with a journal is
   loaded with the existing connected-ledger reader (cached per component, so the
   32-account component bound still applies) and projected once at the instant. Each
   account's lots give its positions; lots move between accounts with transfers, so a
   sum over accounts counts each unit once.
3. **Market price joins on the ticker.** M3 keyed observations by catalog code, and
   M2 sets `priceSource = market` only for a crypto instrument whose upper-case ticker
   is a catalog code. The read `latestMarketPrices(manager, codes, at)` moves from the
   prices service into a shared function used by `GET /prices` and the portfolio, so
   both apply the same tie-break (latest instant, then kind descending: spot, hourly
   close, daily close; then source name).
4. **Manual price: latest effective point at or before now.** For each instrument the
   current version of every manual price point is taken first, void points are
   dropped, then the latest remaining point at or before the instant wins. This is the
   product valuation rule; the legacy exact-instant reads are unchanged.
5. **Fixed fiat.** USD cash has price 1. EUR and RUB need Bank of Russia rates (M5), so
   they are `no-rate`, never converted with an invented rate.
6. **Exact arithmetic, display rounding.** Values are scale-60 products of scale-30
   decimals, as in the existing valuation; costs and realized results are scale-30.
   The average buy price is a quotient rounded half away from zero at 30 decimals;
   percentages use the existing two-decimal display ratio.
7. **Realized P&L per asset.** FIFO sale realizations carry their instrument; a swap's
   realized result belongs to the outgoing instrument. An unknown realization makes
   that asset's (and the total) realized P&L null with the known subtotal kept.
8. **Unknown cost.** Following `unrealized-profit-loss`, cost basis and unrealized P&L
   are null when any remaining quantity has unknown cost. The average buy price uses
   the known-cost part only, as the accepted prototype does.
9. **Every instrument listed.** The Portfolio table replaces M2's classification list,
   so the response includes unheld instruments with quantity 0. Assets are ordered
   held-and-priced by value, held-unpriced, then unheld by name.
10. **Frontend.** The Portfolio page reads only the new endpoint and reloads it after
    "Add asset". The Asset page reads the same endpoint and selects the asset; the
    response is small for one owner and avoids a second endpoint.

## Risks / Trade-offs

- Whole-portfolio reads replay every account on each request. One owner has a few
  accounts with at most thousands of operations; the existing bounds (1000 active
  trades per account, 32 accounts per component) keep it bounded. Snapshots (M6) will
  cache history, not this current read.
- A corrupt journal anywhere makes the whole portfolio fail with 409 rather than
  silently hiding that account, by design (missing is not zero).
- Chain balances from wallet addresses are not yet part of holdings (M10–M12).
