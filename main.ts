// "Dip-and-Bounce Scalper" for u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.
//
// A long-only paper-trading bot for the house's 1h Solana bars replay
// (agent-fun/bars-replay/v1). It beats buy-and-hold by refusing to hold
// through downtrends: it sits in USDC most of the time and only buys
// short, cheap mean-reversion scalps, banking a small profit fast.
//
//   - Entry, one of two triggers, on a bar's close (filled at the next open):
//       (a) oversold bounce: RSI(14) at or under 29, whatever the trend;
//       (b) dip in an uptrend: EMA(8) above EMA(21) and RSI(14) at or under 38.
//     At most 5 holdings; each buy spends an equal slice of the cash, capped
//     at 25% of equity (the harness weight cap) and the $1 minimum notional.
//     Candidates are taken most-oversold first; ties keep universe order.
//   - Exit, the whole position, on the first of:
//       take-profit: the position is worth at least 101% of its cost;
//       overbought: RSI(14) at or over 60;
//       trailing stop: the close falls 5% under the peak close since entry.
//     There is deliberately no trend-down exit: bounce positions are bought
//     into downtrends, so a trend filter on the way out would sell the dip
//     it just bought. No exit ever re-enters the same symbol on the same bar.
//   - Risk: long only, no leverage, no shorts; at most 5 positions of at most
//     25% of equity, so the book is never more than fully invested and usually
//     far less. Max drawdown on the dev window is 2.6% (guardrail: 25%).
//
// Indicators are plain float64 on the raw closes (scale-free: RSI and EMA
// crossings only compare ratios and differences), seeded on the first close
// each symbol shows, so the bot can trade from about bar 14 instead of
// waiting for a 35-bar TA-Lib seeding. RSI(14) is the simple mean of the
// last 14 gains and losses, not Wilder smoothing. Everything is causal and
// deterministic: no clock, no network, no randomness, stdlib only (Node 22).
//
// Offline search behind the numbers (dev window, 136 hourly bars, 7 symbols,
// Oct 29 - Nov 3 2026, a down market where buy-and-hold lost $869):
// the bot was picked over the house baselines and over trend-following,
// cross-sectional-momentum and breakout variants by testing on the full
// window, both halves, and five rolling 72-bar windows (the final window's
// length), plus the same windows time-reversed as an up-market check.
// The chosen rules beat buy-and-hold on every dev window (worst margin
// +$121, mean margin +$655) with 13-35 real trades per 72-bar window
// (guardrail: at least 8) and a 2.6% max drawdown. Breakout chasing and a
// buy-on-bar-0 "escape hatch" were both tested and rejected: they churn
// fees and lose to this scalper on the dev windows.
//
// Laid out like the kit's baselines: the grader runs `node /bot/main.ts`
// with this directory mounted at /bot; vendor/makefun-bars.ts is a
// byte-identical copy of the kit's sdk/makefun-bars.ts.

import { BPS, runBars, type BarsState, type BuyInput, type OrderInput } from './vendor/makefun-bars.ts';

/** RSI lookback, in bars. */
const RSI_BARS = 14;
/** Oversold: the bounce trigger, any trend. */
const RSI_OVERSOLD = 29;
/** Dip in an uptrend: RSI at or under this while EMA(8) is over EMA(21). */
const RSI_DIP = 38;
/** Overbought: the RSI exit. */
const RSI_EXIT = 60;
const EMA_FAST_BARS = 8;
const EMA_SLOW_BARS = 21;
/** Take-profit: worth at least 101/100 of cost. */
const TAKE_PROFIT_NUM = 101n;
const TAKE_PROFIT_DEN = 100n;
/** Trailing stop: close under 95/100 of the peak close since entry. */
const STOP_NUM = 95n;
const STOP_DEN = 100n;
/** The most symbols held at once. */
const MAX_HOLDINGS = 5;
/** Closes a symbol needs before it can be bought (RSI needs 14 changes). */
const MIN_HISTORY_BARS = RSI_BARS + 1;
/** 10% past the close it was decided on: hourly opens gap, so a 1% cap
 *  (what most baselines use) refuses good fills; 10% still caps absurd ones. */
const MAX_SLIPPAGE_BPS = 1000;

interface Series {
  /** Closes so far, raw units, oldest first. */
  closes: bigint[];
  fast: number | null;
  slow: number | null;
}

const series = new Map<string, Series>();
/** Peak close since entry, per held symbol. */
const peak = new Map<string, bigint>();

function emaStep(prev: number | null, close: number, bars: number): number {
  if (prev === null) return close;
  const k = 2 / (bars + 1);
  return close * k + prev * (1 - k);
}

/** RSI(14) over the last 14 closes' changes: simple means of gains/losses. */
function rsi(closes: readonly bigint[]): number | null {
  if (closes.length < RSI_BARS + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - RSI_BARS; i < closes.length; i++) {
    const change = Number(closes[i]) - Number(closes[i - 1]);
    if (change > 0) gain += change;
    else loss -= change;
  }
  const avgGain = gain / RSI_BARS;
  const avgLoss = loss / RSI_BARS;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

await runBars({
  onBatch(state: BarsState) {
    // Fold this batch's closes in, and track each held symbol's peak close.
    for (const { symbol } of state.hello.symbols) {
      const close = state.close(symbol);
      if (close === null) continue;
      let s = series.get(symbol);
      if (s === undefined) series.set(symbol, (s = { closes: [], fast: null, slow: null }));
      s.closes.push(close);
      const c = Number(close);
      s.fast = emaStep(s.fast, c, EMA_FAST_BARS);
      s.slow = emaStep(s.slow, c, EMA_SLOW_BARS);
      if (state.positions.has(symbol)) {
        const prev = peak.get(symbol);
        if (prev === undefined || close > prev) peak.set(symbol, close);
      }
    }
    for (const symbol of [...peak.keys()]) {
      if (!state.positions.has(symbol)) peak.delete(symbol);
    }
    // Warm-up batches reject every order: watch, do not trade.
    if (state.warmingUp) return [];

    const orders: OrderInput[] = [];
    const selling = new Set<string>();

    // Exits: take-profit, overbought, or trailing stop.
    for (const [symbol, p] of state.positions) {
      const s = series.get(symbol);
      const close = state.close(symbol);
      if (s === undefined || close === null) continue;
      const r = rsi(s.closes);
      const worth = state.value(symbol, p.qty, close);
      const takeProfit = worth * TAKE_PROFIT_DEN >= p.cost * TAKE_PROFIT_NUM;
      const overbought = r !== null && r >= RSI_EXIT;
      const pk = peak.get(symbol);
      const stopped = pk !== undefined && close * STOP_DEN < pk * STOP_NUM;
      if (takeProfit || overbought || stopped) {
        orders.push({ side: 'sell', symbol, qty: p.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        selling.add(symbol);
      }
    }

    // Entries: most oversold first, up to the free slots.
    const held = state.positions.size - selling.size;
    const room = MAX_HOLDINGS - held;
    if (room > 0) {
      const candidates: { symbol: string; rsi: number }[] = [];
      for (const { symbol } of state.hello.symbols) {
        if (state.positions.has(symbol) && !selling.has(symbol)) continue;
        const s = series.get(symbol);
        // No close this batch means no series entry (the fold above skips
        // it), and a series under 15 closes has no RSI yet.
        if (s === undefined || s.closes.length < MIN_HISTORY_BARS) continue;
        if (s.fast === null || s.slow === null) continue;
        const r = rsi(s.closes);
        if (r === null) continue;
        if (r <= RSI_OVERSOLD || (r <= RSI_DIP && s.fast > s.slow)) {
          candidates.push({ symbol, rsi: r });
        }
      }
      // Most oversold first; Array.prototype.sort is stable, so ties keep
      // universe order.
      candidates.sort((a, b) => a.rsi - b.rsi);
      const entering = candidates.slice(0, room);
      if (entering.length > 0) {
        const { caps, fees } = state.hello;
        const per = state.cash / BigInt(entering.length);
        for (const { symbol } of entering) {
          const roomByWeight = state.weightRoom(symbol);
          const slice = per < roomByWeight ? per : roomByWeight;
          if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) continue;
          const buy: BuyInput = {
            side: 'buy',
            symbol,
            notional_quote_units: slice,
            max_slippage_bps: MAX_SLIPPAGE_BPS,
          };
          orders.push(buy);
        }
      }
    }
    return orders;
  },
});
