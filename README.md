[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Ajwyunsx/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![reward](https://make.fun/badge/token-radar-01/Ajwyunsx/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A launch-price radar for protocols that record no token — a [make.fun](https://make.fun) bounty entry
for **token-radar-01**.

It reads the house's sealed DefiLlama snapshot (758 protocols, `as_of` 2026-11-14, a 40-protocol
no-token watchlist at a $50M floor), prices every pre-token protocol off the market's own mcap/TVL
curve, ranks 198 of them by implied launch value, and gives each one six concrete steps to farm it.

- **198 rows** — all 40 watchlist protocols plus 158 found below the house floor.
- **One model, written down** — a size regression fitted on the 119 token-bearing protocols in this
  same snapshot, a category factor measured from their residuals, momentum, latency and reach.
- **A dashboard with no network** — `index.html`, `app.css`, `app.js`, 51 KB of source, offline.

## Run

```sh
mkdir -p out
node main.ts --input ../input/snapshot.json     # or MAKEFUN_OUTPUT_DIR=out INPUT=...
```

In the grader: `node main.ts`, reading `/input/snapshot.json` and writing `/output`. Node 22.18+;
standard library only.

Output: `board.json` (the ranked rows), `data.js` (the page's dataset), `dashboard/` and
`screenshots/` copied beside it, and `dossier.json` written by the vendored `buildDossier`. Both runs
on the same bytes write the same bytes — no clock, no randomness, no locale formatting.

## The value model

The claim is narrow and checkable: *if this protocol launched a token today and the market priced it
the way it prices comparable protocols at the same size, what would it be worth?* Five terms, all
from the snapshot's own ten fields.

**1. The size curve.** Every token-bearing non-CEX protocol in the snapshot (119 of them) gives one
point: `log10(mcap/TVL)` against `log10(TVL)`. The OLS fit is

```
log10(mcap/TVL) = 3.3823 − 0.5279 · log10(TVL)
```

so the multiple *falls* with size — about 0.14× at $100M TVL, 0.043× at $1B, 0.025× at $3B. That
elasticity is the single most important thing the snapshot says, and it is why a flat 0.25× multiple
(what the starter used) misprices the whole board.

**2. The category factor.** For each DefiLlama category, the median residual of its token-bearing
members against that curve, shrunk toward 1.00 by `n/(n+4)` so a category with one comparable cannot
run away with the board, and clamped to `[0.5, 2.2]`. The measured set, straight from this snapshot:

| category | factor | n | category | factor | n |
|---|---|---|---|---|---|
| Prediction Market | 2.20 | 1 | Dexs | 1.15 | 11 |
| Privacy | 2.20 | 3 | CDP | 0.91 | 3 |
| Collateral Management | 1.96 | 1 | Yield | 0.89 | 9 |
| Derivatives | 1.85 | 2 | Yield Aggregator | 0.79 | 4 |
| Chain | 1.50 | 1 | Onchain Capital Allocator | 0.78 | 2 |
| Risk Curators | 1.46 | 1 | Lending | 0.71 | 15 |
| Basis Trading | 1.44 | 7 | Payments | 0.69 | 2 |
| RWA | 1.33 | 9 | Indexes | 0.61 | 3 |
| Liquid Restaking | 1.30 | 2 | Liquid Staking | 0.54 | 9 |

Curators and allocators price high because their revenue is a fee on other people's TVL; lending and
liquid staking price low because their TVL is a commodity and their token captures a thin spread.
That is the market's own verdict, not an opinion added on top.

**3. Momentum.** `1 + clamp(change_7d, −50, +150)/100 × 0.30`. A week of TVL growth is a weak signal
about a launch price, so it gets a 0.30 weight and a hard cap: ±45% at the extremes, never enough to
reorder the top of the board on its own.

**4. Latency.** `0.78 + 0.42 · (1 − e^(−age/450))`, with a haircut past four years. A protocol that
has run a year with no token has demonstrated it can run without one; a launch is a live option, and
options are worth more with time on the clock. Past ~1,460 days the opposite sets in — a decade
without a token starts to read as a decision — so the multiplier decays by up to 12%.

**5. Reach.** `1 + min(0.12, 0.02 · (chains − 1))`. Each additional chain is another venue a token
can be sold into, capped at +12%.

The product is the implied value, with the ratio clamped to `[0.006, 1.8]` so no single term can
produce an absurd row. `data.js` carries every multiplier per row, and the detail view prints the
whole waterfall — TVL, ratio at size, category factor, ratio after factor, momentum, latency, reach,
value — so any number on the board can be recomputed by hand from the snapshot.

**What the board is not.** It is not a prediction that a token will be issued, and it is not advice.
DefiLlama's record is not proof of anything: a row says a protocol *records no token*, never that it
has none. Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories
are excluded as products of a token that already trades, as are version-suffixed names, wrapped and
staked products, and exchange-branded products.

**Who is on it.** The 40 watchlist slugs, because the gate requires them. Then every other rankable
pre-token protocol in the snapshot, ranked by the same model — 158 of them sit below the $50M floor,
and that tail is where a radar earns its keep: Snuggle at $2.5M and Block Analitica at $6.9M are on
the board because the model prices them, not because a list named them.

## The dashboard

Three views, state in the URL hash so any view is linkable:

- **Board** (`#/board`) — 198 rows, sortable on rank, TVL, 7d, age, mcap/TVL and implied value;
  each row carries its category, its chain count and a floor/under-floor marker.
- **Filtered** (`#/filtered`) — the same rows as cards, with search, category, chain, token-status
  and watchlist filters; totals recompute against the filter.
- **Detail** (`#/p/<slug>`) — the hero, the six farm steps with cost and time, the value waterfall,
  the category's comparables, a five-cell sensitivity strip (the same model with one input shifted),
  and the rows either side of it on the board.

Dark terminal palette: phosphor green `#3ee6a8` for value, amber `#f4b24a` for attention, mono
numerals with tabular figures, no framework, no fonts to fetch, no network of any kind.

## Farm plans

Each row's steps come from its category family — curators, allocators, lending, perps, DEX/LP, basis
trading, RWA, chains, restaking, payments, prediction markets, insurance, indexes, privacy, AI — and
name the mechanic the protocol actually runs: which vault, which pool, which chain, what a position
costs and how long it has to stay open. Six steps per row, generated in `lib/model.ts` from the
protocol's category, chains, TVL and age, so no two rows share a plan.

## Repo

```
main.ts              reads the snapshot, writes /output, builds the dossier
lib/model.ts         the implied-value model, the ranking, the farm plans
vendor/              make.fun's buildDossier (unmodified)
dashboard/           index.html, app.css, app.js — the page
screenshots/         the board, one detail view, one filtered view
tools/shoot.mjs      headless-Chrome capture of the three screenshots
```

## License

MIT — see `LICENSE`.
