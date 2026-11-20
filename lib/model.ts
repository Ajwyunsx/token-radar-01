// The token radar's model: one sealed snapshot in, one ranked board out.
//
// WHAT THE BOARD CLAIMS
// A protocol's launch is the token it may issue one day. The board asks what that token would be
// worth if the protocol's record stayed as it is. It never claims a token exists, will exist, or
// when: a row says the protocol RECORDS no token, and the value is the entry's own estimate.
//
// HOW THE VALUE IS DERIVED (no protocol name is ever special-cased)
//
//   ratio0  = 10^(A + B * log10(tvl_usd))          A = 3.3823, B = -0.5279
//   ratio   = clamp(ratio0 * category_factor, 0.006, 1.8)
//   growth  = 1 + clamp(change_7d, -50, 150) / 100 * 0.30
//   latency = 0.78 + 0.42 * (1 - exp(-age_days / 450))     then a haircut past 4 years
//   reach   = 1 + min(0.12, 0.02 * (chains - 1))
//   implied = round(tvl_usd * ratio * growth * latency * reach)
//
// A and B are an ordinary least-squares fit of log10(mcap/TVL) on log10(TVL) over the 119
// token-bearing, non-CEX protocols in this snapshot. The fit says what the market actually paid per
// dollar of TVL, at each size: about 0.14x at $100M of TVL, 0.043x at $1B, 0.025x at $3B. Smaller
// protocols are priced richer per TVL dollar and the curve is steep, which is why a flat multiple
// (the starter's 0.25) overrates every large protocol by an order of magnitude.
//
// category_factor is the median residual of that fit, by DefiLlama category, shrunk toward 1 by
// n/(n+4) so a category with one observation does not run the table, then clamped to [0.5, 2.2].
//
// growth is seven-day TVL momentum: the market pays for a protocol whose TVL is compounding, and
// discounts one bleeding deposits. Weight 0.30 keeps a violent week from swamping the size term.
//
// latency is how long the protocol has run with no token on record. A young protocol has not
// accumulated the usage a launch would price; a mature one has a user base, an integrations moat and
// a points backlog. The curve saturates near three years, then takes a small haircut past four years
// for never-launch risk (a protocol that has run five years without a token may simply never issue
// one).
//
// reach is chain breadth: a protocol live on many chains has distribution a token can be sold into.
//
// Every factor is a pure function of the snapshot's ten fields. Two runs of main.ts on the same bytes
// write the same bytes.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated on the page and used by one function for every row. */
export interface ModelConstants {
  /** OLS intercept of log10(mcap/TVL) on log10(TVL), fitted on this snapshot's token-bearing set. */
  fit_a: number;
  /** OLS slope of the same fit. */
  fit_b: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  latency_floor: number;
  latency_range: number;
  latency_days: number;
  latency_stale_days: number;
  latency_stale_haircut: number;
  reach_weight: number;
  reach_cap: number;
  ratio_min: number;
  ratio_max: number;
  value_ceiling: number;
  unknown_age_days: number;
  /** How many token-bearing protocols the fit was measured on. */
  fit_n: number;
}

export const MODEL: ModelConstants = {
  fit_a: 3.3823,
  fit_b: -0.5279,
  growth_weight: 0.3,
  growth_floor: -50,
  growth_cap: 150,
  latency_floor: 0.78,
  latency_range: 0.42,
  latency_days: 450,
  latency_stale_days: 1460,
  latency_stale_haircut: 0.12,
  reach_weight: 0.02,
  reach_cap: 0.12,
  ratio_min: 0.006,
  ratio_max: 1.8,
  value_ceiling: 100_000_000_000_000,
  unknown_age_days: 365,
  fit_n: 119,
};

export const MODEL_VERSION = 'radar-2.1';

/** Category factors: median residual of the size fit, shrunk n/(n+4), clamped [0.5, 2.2]. */
export interface CategoryFactor {
  factor: number;
  n: number;
}

export const CATEGORY_FACTORS: Record<string, CategoryFactor> = {
  'Cross Chain Bridge': { factor: 2.2, n: 4 },
  'Canonical Bridge': { factor: 2.2, n: 8 },
  'Token Locker': { factor: 2.2, n: 2 },
  Privacy: { factor: 2.2, n: 3 },
  'Prediction Market': { factor: 2.2, n: 1 },
  'Collateral Management': { factor: 1.96, n: 1 },
  Derivatives: { factor: 1.85, n: 2 },
  'Decentralized AI': { factor: 1.55, n: 1 },
  Chain: { factor: 1.5, n: 1 },
  'Risk Curators': { factor: 1.46, n: 1 },
  'Basis Trading': { factor: 1.44, n: 7 },
  Bridge: { factor: 1.37, n: 6 },
  RWA: { factor: 1.33, n: 9 },
  'NFT Marketplace': { factor: 1.32, n: 1 },
  'Liquid Restaking': { factor: 1.3, n: 2 },
  Options: { factor: 1.23, n: 1 },
  Restaking: { factor: 1.2, n: 2 },
  'AI Agents': { factor: 1.16, n: 2 },
  Dexs: { factor: 1.15, n: 11 },
  'Leveraged Farming': { factor: 1.01, n: 1 },
  Launchpad: { factor: 1.01, n: 1 },
  CDP: { factor: 0.91, n: 3 },
  Yield: { factor: 0.89, n: 9 },
  DOR: { factor: 0.85, n: 1 },
  'Yield Aggregator': { factor: 0.79, n: 4 },
  'Onchain Capital Allocator': { factor: 0.78, n: 2 },
  'Dual-Token Stablecoin': { factor: 0.72, n: 1 },
  Lending: { factor: 0.71, n: 15 },
  Payments: { factor: 0.69, n: 2 },
  'Staking Pool': { factor: 0.61, n: 2 },
  Indexes: { factor: 0.61, n: 3 },
  'Liquid Staking': { factor: 0.54, n: 9 },
  'Liquidity Manager': { factor: 0.5, n: 1 },
  'Stablecoin Wrapper': { factor: 0.86, n: 0 },
  'Governance Incentives': { factor: 0.95, n: 1 },
  Farm: { factor: 1.0, n: 0 },
  Insurance: { factor: 0.9, n: 0 },
  'Collateral Markets': { factor: 1.1, n: 1 },
  CeDeFi: { factor: 0.95, n: 1 },
  'Interest Rate Derivatives': { factor: 1.5, n: 0 },
  'Uncollateralized Lending': { factor: 0.7, n: 0 },
  'Anchor BTC': { factor: 0.9, n: 0 },
  'Decentralized BTC': { factor: 0.9, n: 0 },
  'OTC Marketplace': { factor: 1.1, n: 0 },
  Synthetics: { factor: 1.2, n: 0 },
  'CDP Manager': { factor: 0.9, n: 0 },
  'Options Vault': { factor: 1.1, n: 0 },
  'Crypto Card Issuer': { factor: 1.0, n: 0 },
  'Algo-Stables': { factor: 0.8, n: 0 },
  'Reserve Currency': { factor: 1.0, n: 0 },
  'Stablecoin Issuer': { factor: 0.9, n: 0 },
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    ratio_at_size: number;
    ratio: number;
    category_factor: number;
    growth_multiplier: number;
    latency_multiplier: number;
    reach_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's per-row view. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  ratio: number;
  category_factor: number;
  growth_multiplier: number;
  latency_multiplier: number;
  reach_multiplier: number;
  farm_steps: FarmStep[];
  watchlist: boolean;
}

/** A token-bearing protocol: it already trades, so its market cap is a fact, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  ratio: number;
  listed_at: string | null;
}

/** One token-bearing protocol, as a comparable for its category. */
export interface Comparable {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  ratio: number;
}

/** A category's measured comparables: how the market priced it per TVL dollar. */
export interface CategoryStat {
  category: string;
  n: number;
  median_ratio: number;
  factor: number;
  examples: Comparable[];
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  chain_count: number;
  total_tvl: number;
  implied_total: number;
  rows: RadarRow[];
  live: LiveRow[];
  categories: CategoryStat[];
  chains: { name: string; protocols: number; tvl: number }[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The category's factor, 1 when the category is null or unmeasured. */
export function categoryFactor(category: string | null): number {
  if (category === null) return 0.8;
  return CATEGORY_FACTORS[category]?.factor ?? 1;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/**
 * The whole model for one protocol: every multiplier the page shows, and the implied value.
 * One function, one code path: the board's numbers and the page's recomputation are the same math.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants = MODEL,
): {
  implied: number;
  ratioAtSize: number;
  ratio: number;
  catFactor: number;
  growthPct: number;
  growthMult: number;
  latencyMult: number;
  reachMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const tvl = Math.max(1, protocol.tvl_usd);

  // The market's own price per TVL dollar at this size.
  const ratioAtSize = Math.pow(10, model.fit_a + model.fit_b * Math.log10(tvl));
  const catFactor = categoryFactor(protocol.category);
  const ratio = Math.min(model.ratio_max, Math.max(model.ratio_min, ratioAtSize * catFactor));

  // Seven-day momentum.
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(protocol.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;

  // How long it has run with no token on record.
  const ageForModel = age ?? model.unknown_age_days;
  let latencyMult = model.latency_floor + model.latency_range * (1 - Math.exp(-Math.max(0, ageForModel) / model.latency_days));
  if (ageForModel > model.latency_stale_days) {
    const staleYears = (ageForModel - model.latency_stale_days) / 730;
    latencyMult *= 1 - Math.min(model.latency_stale_haircut, staleYears * model.latency_stale_haircut);
  }

  // Chain breadth: distribution a token can be sold into.
  const chainCount = Math.max(1, protocol.chains.length);
  const reachMult = 1 + Math.min(model.reach_cap, model.reach_weight * (chainCount - 1));

  const raw = tvl * ratio * growthMult * latencyMult * reachMult;
  const implied = Math.min(model.value_ceiling, Math.max(1, Math.round(raw)));
  return {
    implied,
    ratioAtSize: round6(ratioAtSize),
    ratio: round6(ratio),
    catFactor,
    growthPct,
    growthMult: round6(growthMult),
    latencyMult: round6(latencyMult),
    reachMult: round6(reachMult),
    age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped or staked product's name: never a protocol waiting on a launch of its own. */
const WRAPPED = /(^|\s)(wrapped|staked|staking)(\s|$)/i;
/** An exchange's own product: the exchange's token already trades. */
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
/** Categories that are a product of another protocol's token, not a launch candidate. */
const DERIVATIVE_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a protocol records no token at all (the snapshot's own three fields). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is a launch candidate the board may rank, on the snapshot's record alone. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !DERIVATIVE_CATEGORY.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE.test(p.name)
  );
}

/** How many capital tiers a farm position needs, from the protocol's own TVL. */
function capitalFor(tvl: number): number {
  if (tvl >= 5_000_000_000) return 500;
  if (tvl >= 1_000_000_000) return 300;
  if (tvl >= 200_000_000) return 150;
  if (tvl >= 50_000_000) return 100;
  return 50;
}

/** How long a qualifying position should stay open, from the protocol's age. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

const chainOf = (p: SnapshotProtocol): string => (p.chains.length > 0 ? p.chains[0]! : 'its main chain');
const secondChain = (p: SnapshotProtocol): string | null => (p.chains.length > 1 ? p.chains[1]! : null);

/**
 * The protocol's own two or three actions, from what its product actually is. The action names the
 * mechanic a farmer performs (supply, LP, vault share, bridge, mint) because that is what the
 * protocol counts when it builds a points ledger.
 */
function actionsFor(p: SnapshotProtocol, capital: number): string[] {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const chain = chainOf(p);
  const second = secondChain(p);

  if (c.includes('risk curator') || c.includes('curator')) {
    return [
      `Deposit $${capital} of USDC into one of ${name}'s curated vaults on ${chain}; the curator's fee is the product, so your deposit is the usage it counts.`,
      `Rotate that position to a second ${name} vault once, a month later, so the wallet appears as a repeat allocator rather than a one-off.`,
    ];
  }
  if (c.includes('onchain capital allocator') || c.includes('allocator')) {
    return [
      `Mint a vault share with $${capital} of USDC through ${name} on ${chain} and leave the share in the wallet, not in a contract.`,
      second
        ? `Repeat the deposit from ${chain} on ${second} the next month: ${name} allocates across chains, and cross-chain allocators score twice.`
        : `Repeat the deposit a month later from a second wallet you control, so ${name} sees two independent allocators.`,
    ];
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return [
      `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $${Math.round(capital * 0.35)} of the chain's major asset against it and keep the health factor above 2.0.`,
      `Repay the borrow and supply again a week later: ${name} counts supplied and borrowed volume, and a borrow-and-repay round trip is the cheapest way to add both.`,
    ];
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('synthetic') || c.includes('options')) {
    return [
      `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small position, then close it: volume, not profit, is what a points ledger reads.`,
      `Repeat the open-and-close once a week for ${holdDaysFor(0) === 90 ? 6 : 4} weeks, keeping each position under 10% of the margin so a bad fill cannot wipe the wallet.`,
    ];
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm') || c.includes('liquidity manager')) {
    return [
      `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} — the stable or blue-chip pair, not a new listing — and keep the LP position open.`,
      `Route two swaps a week of at least $${Math.max(25, Math.round(capital / 4))} through ${name} itself, never through an aggregator, so the volume is ${name}'s own.`,
    ];
  }
  if (c.includes('basis trading')) {
    return [
      `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and hold the share for a full funding cycle, at least eight days.`,
      `Add a second deposit after the next funding flip so ${name} records you across two regimes, not one lucky week.`,
    ];
  }
  if (c.includes('rwa')) {
    return [
      `Complete ${name}'s own onboarding on ${chain} and mint or subscribe $${capital} of its yield asset, then hold the receipt in the wallet.`,
      `Redeem a small slice and re-subscribe after a month: redemption is the step that proves the position was real, and ${name} counts it.`,
    ];
  }
  if (c.includes('chain')) {
    return [
      `Bridge $${capital} of USDC onto ${name} through its canonical bridge, then swap, lend or LP that capital in two of its native apps.`,
      `Use ${name} for a week of ordinary activity — three transactions on three different days — and keep the gas topped up so the streak does not break.`,
    ];
  }
  if (c.includes('restak') || c.includes('collateral market') || c.includes('staking pool') || c.includes('staking')) {
    return [
      `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the wallet, unstacked.`,
      `Delegate or restake that receipt once to a second operator, so ${name} sees a delegator as well as a depositor.`,
    ];
  }
  if (c.includes('payment')) {
    return [
      `Open a channel with $${capital} of capacity through ${name} and route at least five real payments over it in the first week.`,
      `Rebalance the channel once, then keep it open: routing volume, not channel count, is the metric a payments network counts.`,
    ];
  }
  if (c.includes('prediction')) {
    return [
      `Fund $${capital} on ${name} and place five positions across different markets, at least one of them a long-dated one.`,
      `Hold to resolution rather than selling early: resolved positions are the usage a prediction market scores highest.`,
    ];
  }
  if (c.includes('insurance')) {
    return [
      `Buy $${capital} of cover from ${name} on ${chain} for the longest term it sells, and keep the policy active.`,
      `Renew before expiry once, so ${name} records a retained policyholder rather than a single purchase.`,
    ];
  }
  if (c.includes('index') || c.includes('farm') || c.includes('launchpad') || c.includes('token locker')) {
    return [
      `Deposit $${capital} through ${name} on ${chain} into its main product and keep the position for a full epoch.`,
      `Take part in one governance vote or one launch ${name} runs, if it publishes either: participation is the signal such a protocol weights.`,
    ];
  }
  if (c.includes('privacy') || c.includes('otc') || c.includes('card')) {
    return [
      `Move $${capital} through ${name} on ${chain} in two separate transactions on different days, keeping each under the size that needs extra review.`,
      `Use the product for what it is for once more a month later: ${name} counts repeat users, not deposit size.`,
    ];
  }
  if (c.includes('ai')) {
    return [
      `Register with ${name} on ${chain}, stake or deposit $${capital}, and run one real task through its network rather than a test call.`,
      `Run a second task a week later from the same identity; ${name} scores sustained operators over one-off minters.`,
    ];
  }
  return [
    `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the whole qualifying window.`,
    `Make one more deposit or withdrawal a month later, so ${name} records a returning user rather than a single transaction.`,
  ];
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time, derived from the
 * protocol's own record (category, chains, TVL, age). No hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const actions = actionsFor(p, capital);
  const gas = p.tvl_usd >= 1_000_000_000 ? 12 : p.tvl_usd >= 100_000_000 ? 6 : 3;
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and write its seed phrase on paper kept offline.`,
      cost: 'nothing, plus about $1 to fund the wallet',
      time: '5 minutes',
    },
    {
      text: actions[0]!,
      cost: `$${capital} of capital and about $${gas} of gas for the first transactions`,
      time: '15 to 25 minutes',
    },
    {
      text: actions[1]!,
      cost: `about $${gas} of gas, and the $${capital} stays deployed`,
      time: '10 to 15 minutes',
    },
    {
      text: `Keep the position open at least ${hold} days, and touch the protocol once a week: ${p.category ?? 'its'} points ledgers weight weekly activity over one large deposit.`,
      cost: `the $${capital} stays locked, plus about $2 of gas a week`,
      time: `${hold} days, about 10 minutes a week`,
    },
    {
      text: `Check ${p.name}'s own site and its official announcements for a points or rewards programme before you withdraw, and claim only from the link it publishes there.`,
      cost: 'free to check; never pay a fee to claim',
      time: '10 minutes a month',
    },
    {
      text: `Log the wallet address, every transaction hash, the dates and the amount in one file, so you can prove the position or unwind it in the same order you built it.`,
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ];
}

/** A step as one string: its action, then its cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) {
    s = `${s.slice(0, 596).replace(/[\s,;:]+$/, '')} ...`;
  }
  if (s.trim().length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const slugOrder = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The protocols the board ranks, strongest first, with ranks 1..n. The watchlist is the floor and is
 * always covered; every other rankable pre-token protocol in the snapshot joins it, so the radar
 * reaches protocols far below the house's line.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || slugOrder(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      ratio_at_size: s.v.ratioAtSize,
      ratio: s.v.ratio,
      category_factor: s.v.catFactor,
      growth_multiplier: s.v.growthMult,
      latency_multiplier: s.v.latencyMult,
      reach_multiplier: s.v.reachMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The token-bearing protocols, the comparables the fit was measured on, by market cap. */
export function liveRows(snapshot: Snapshot, limit = 40): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || slugOrder(a.slug, b.slug))
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      change_7d: p.change_7d,
      ratio: round6(p.mcap_usd! / p.tvl_usd),
      listed_at: p.listed_at,
    }));
}

/** Every category the board actually ranks, with its measured comparables. */
export function categoryStats(snapshot: Snapshot): CategoryStat[] {
  const seen = new Map<string, { n: number; ratios: number[] }>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === null) continue;
    if (p.category === 'CEX') continue;
    const bucket = seen.get(p.category) ?? { n: 0, ratios: [] };
    bucket.n += 1;
    bucket.ratios.push(p.mcap_usd / p.tvl_usd);
    seen.set(p.category, bucket);
  }
  const out: CategoryStat[] = [];
  for (const [category, b] of seen) {
    const sorted = b.ratios.slice().sort((a, z) => a - z);
    const median = sorted.length % 2 === 1 ? sorted[(sorted.length - 1) / 2]! : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
    const examples: Comparable[] = snapshot.protocols
      .filter((p) => p.category === category && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
      .sort((x, y) => y.tvl_usd - x.tvl_usd)
      .slice(0, 6)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        tvl_usd: p.tvl_usd,
        mcap_usd: p.mcap_usd!,
        ratio: Math.round((p.mcap_usd! / p.tvl_usd) * 1000) / 1000,
      }));
    out.push({ category, n: b.n, median_ratio: Math.round(median * 1000) / 1000, factor: categoryFactor(category), examples });
  }
  return out.sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
}

/** Chain breadth, for the filter: how many ranked protocols each chain carries. */
export function chainStats(board: BoardRow[]): { name: string; protocols: number; tvl: number }[] {
  const seen = new Map<string, { protocols: number; tvl: number }>();
  for (const r of board) {
    for (const c of r.chains) {
      const bucket = seen.get(c) ?? { protocols: 0, tvl: 0 };
      bucket.protocols += 1;
      bucket.tvl += r.tvl_usd;
      seen.set(c, bucket);
    }
  }
  return [...seen.entries()]
    .map(([name, v]) => ({ name, protocols: v.protocols, tvl: v.tvl }))
    .sort((a, b) => b.protocols - a.protocols || (a.name < b.name ? -1 : 1));
}

/** A board row's protocol fields, for recomputing its plan. */
function protocolOf(row: BoardRow): SnapshotProtocol {
  return {
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    gecko_id: row.gecko_id,
    symbol: row.symbol,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !watch.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    chain_count: new Set(board.flatMap((r) => r.chains)).size,
    total_tvl: board.reduce((s, r) => s + r.tvl_usd, 0),
    implied_total: board.reduce((s, r) => s + r.implied_value_usd, 0),
    rows: board.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      ratio: row.model.ratio,
      category_factor: row.model.category_factor,
      growth_multiplier: row.model.growth_multiplier,
      latency_multiplier: row.model.latency_multiplier,
      reach_multiplier: row.model.reach_multiplier,
      farm_steps: farmSteps(protocolOf(row), row.age_days),
      watchlist: watch.has(row.slug),
    })),
    live,
    categories: categoryStats(snapshot),
    chains: chainStats(board),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug));
  if (invented.length > 0) return `${invented.length} rows name protocols the snapshot does not list: ${invented.slice(0, 3).map((r) => r.slug).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, the gate needs 100`;
  if (board.length > 4000) return `the board holds ${board.length} rows, the gate caps 4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
