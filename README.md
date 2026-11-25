[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rrmmllnn/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/rrmmllnn/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

# Dip-and-Bounce Scalper — Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana

Entry for the [Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
bounty on make.fun: a long-only paper-trading bot for the house's 1h Solana
bars replay (`agent-fun/bars-replay/v1`, 7 symbols: FARTCOIN, JITOSOL,
POPCAT, RAY, SOL, WETH, WIF; $10,000 USDC; 10 bps fee + 5 bps slippage).

**The idea in one line:** refuse to hold through downtrends — sit in USDC
and only buy short, cheap mean-reversion scalps, banking a small profit fast.

**Strategy** (see `main.ts`, the entrypoint, Node 22 erasable TypeScript):

- Entry, on a bar's close (filled at the next open), one of two triggers:
  - (a) oversold bounce: RSI(14) at or under 29, whatever the trend;
  - (b) dip in an uptrend: EMA(8) above EMA(21) and RSI(14) at or under 38.
- At most 5 holdings; each buy spends an equal slice of the cash, capped at
  25% of equity (the harness weight cap). Candidates are taken most-oversold
  first.
- Exit, the whole position, on the first of: take-profit at +1% over cost,
  RSI(14) at or over 60, or a 5% trailing stop under the peak close since
  entry. No trend-down exit: bounce positions are bought into downtrends.
- Risk: long only, no leverage, no shorts; usually far less than fully
  invested.

**Dev grade** (kit `grade-local`, `--driver process`, run twice, identical):
Net PnL **+$403.71** (+4.04%), max drawdown 2.57%, 45 trades, 0 rejected,
6 distinct symbols — vs buy-and-hold **−$869.34** (−8.69%, 7 trades) and the
best house baseline (macd-cci) −$20.22 on the same dev window. The bot also
beat buy-and-hold on every sub-window tested (both halves and five rolling
72-bar windows, the final window's length): worst margin +$121, mean margin
+$655, 13–35 real trades per 72-bar window (guardrail: at least 8).

Deterministic: no clock, no network, no randomness; stdlib only (Node 22).
Payout wallet: `9mj3bFTaPbEcp5tngSCZ1bKHxmvc3ZhSZ6eDvQYpJzg3` (see
`.makefun/owner.json`). No real money is traded — the bot runs only in the
kit's simulator/harness.

---

<sub>Entered on [make.fun](https://make.fun/?ref=5hwq4sqk&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
