import { entryEmaFilterName, entryEmaWarmupBars, normalizeEntryEmaGate } from "@/lib/entry-ema-gate";
import { skipReasonLabel } from "@/lib/skip-reason-stats";
import { STRATEGY_FILTER_THRESHOLDS } from "@/lib/strategy-filter-thresholds";
import {
  VOLUME_WIGGLE,
  changePct,
  clock,
  mean,
  round2,
  signedPct,
  usd,
  type Scenario,
  type ScenarioStep,
} from "@/lib/strategy-scenarios";
import type { Settings } from "@/lib/types/database";

/**
 * Walkthroughs for the Common skip reasons card. Same idea as the breakout examples:
 * made-up symbols and prices, thresholds from the user's current settings.
 */

type SkipSettings = Partial<Settings>;

const OPEN_MINUTES = 9 * 60 + 30;

function logged(key: string): string {
  return `Predictions logs it as "${skipReasonLabel(key)}".`;
}

function flatPrices(count: number, base: number): number[] {
  const wiggle = [0, 0.04, -0.03, 0.06, 0.01, -0.04, 0.03, -0.01];
  return Array.from({ length: count }, (_, i) => round2(base + wiggle[i % wiggle.length]!));
}

function steadyVolumes(count: number): number[] {
  return Array.from({ length: count }, (_, i) => 12_000 + VOLUME_WIGGLE[i % VOLUME_WIGGLE.length]!);
}

function ema(prices: number[], period: number): (number | null)[] {
  const alpha = 2 / (period + 1);
  let current = prices[0]!;
  return prices.map((price, i) => {
    current = i === 0 ? price : alpha * price + (1 - alpha) * current;
    return i >= period - 1 ? round2(current) : null;
  });
}

function volumeScenario(settings: SkipSettings): Scenario {
  const configured = settings.min_volume_ratio ?? 0;
  const off = configured <= 0;
  const min = off ? 1 : configured;
  const b = 20;
  const prices = flatPrices(b + 3, 142.5);
  const volumes = steadyVolumes(b + 3);
  const baseline = mean(volumes.slice(b - 10, b));
  volumes[b] = Math.round(baseline * min * 0.45);
  volumes[b + 1] = Math.round(baseline * (min + 0.5));
  volumes[b + 2] = Math.round(baseline * (min + 0.3));
  const low = volumes[b]! / baseline;
  const back = volumes[b + 1]! / baseline;
  const offNote = off
    ? " Your Min volume ratio is off right now, so the bot wouldn't skip here. This shows what happens if you turn it on."
    : "";
  return {
    id: "volume_too_low",
    title: skipReasonLabel("volume_too_low"),
    summary: "Jev says BUY, but hardly anyone is trading the stock right now.",
    steps: [
      {
        time: clock(b - 1, OPEN_MINUTES),
        title: "A BUY on a quiet stock",
        body: "Jev rates NFLX a BUY and the stock looks fine. The bot also compares the last minute of trading to the recent average, because thin trading makes it hard to get in and out at a fair price.",
        frame: { kind: "chart", prices, volumes, cursor: b - 1 },
      },
      {
        time: clock(b, OPEN_MINUTES),
        title: "Last minute is too light",
        body: `Only ${low.toFixed(1)}× the recent average traded. You need at least ${min}×, so the bot skips this one. ${logged("volume_too_low")}${offNote}`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: b,
          barTone: { index: b, tone: "bad" },
          marker: { index: b, label: "Skipped", tone: "bad" },
        },
      },
      {
        time: clock(b + 1, OPEN_MINUTES),
        title: "Volume picks back up",
        body: `A minute later trading is ${back.toFixed(1)}× the average. That clears your ${min}× bar, so if Jev still says BUY and the other checks pass, the bot can go ahead.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: b + 1,
          barTone: { index: b + 1, tone: "good" },
        },
      },
    ],
  };
}

function belowEmaScenario(settings: SkipSettings): Scenario {
  const gate = normalizeEntryEmaGate(settings.entry_ema_gate);
  const name = entryEmaFilterName(gate) ?? "EMA-20";
  const period = gate === "ema_9" ? 9 : 20;
  const key = gate === "ema_9" ? "price_below_ema9" : "price_below_ema20";
  const n = period + 12;
  const dip = n - 3;
  const reclaim = n - 1;
  const prices: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const prevEma = i > 0 ? (ema(prices, period)[i - 1] ?? prices[i - 1]!) : prices[0]!;
    let price = round2(95 + 0.12 * i);
    if (i === dip) price = round2(prevEma - 0.3);
    else if (i === dip + 1) price = round2(prevEma - 0.1);
    else if (i === reclaim) price = round2(prevEma + 0.5);
    prices.push(price);
  }
  const line = ema(prices, period);
  const volumes = steadyVolumes(n);
  const offNote =
    gate === "off"
      ? ` Your trend rule is off right now, so the bot wouldn't skip here. This shows what happens if you turn on ${name}.`
      : "";
  const bars = period === 9 ? "9-minute" : "20-minute";
  return {
    id: "price_below_ema20",
    title: skipReasonLabel(key),
    summary: `Jev says BUY, but the price is under its ${bars} trend line.`,
    steps: [
      {
        time: clock(dip - 1, OPEN_MINUTES),
        title: "Climbing above the trend line",
        body: `${name} is the average price over roughly the last ${period} minutes, drawn as the dashed line. While the price sits above it, the stock is trending up.`,
        frame: { kind: "chart", prices, volumes, cursor: dip - 1, ema: { values: line, label: name } },
      },
      {
        time: clock(dip, OPEN_MINUTES),
        title: "Price slips under the line",
        body: `Jev says BUY, but the price is ${usd(prices[dip]!)} against ${name} at ${usd(line[dip]!)}. Your rule wants price above it, so the bot skips. ${logged(key)}${offNote}`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: dip,
          ema: { values: line, label: name },
          marker: { index: dip, label: "Skipped", tone: "bad" },
        },
      },
      {
        time: clock(reclaim, OPEN_MINUTES),
        title: "Price climbs back above",
        body: `Two minutes later the price is ${usd(prices[reclaim]!)}, above ${name} at ${usd(line[reclaim]!)}. This check now passes. The other filters still have their say.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: reclaim,
          ema: { values: line, label: name },
          marker: { index: reclaim, label: "Passes", tone: "good" },
        },
      },
    ],
  };
}

function warmingUpScenario(settings: SkipSettings): Scenario {
  const gate = normalizeEntryEmaGate(settings.entry_ema_gate);
  const name = entryEmaFilterName(gate) ?? "EMA-20";
  const period = entryEmaWarmupBars(gate) ?? 20;
  const n = period + 4;
  const prices = Array.from({ length: n }, (_, i) => round2(61 + 0.05 * i + (i % 3 === 0 ? 0.04 : 0)));
  const line = ema(prices, period);
  const volumes = steadyVolumes(n);
  const ready = period - 1;
  const offNote =
    gate === "off"
      ? ` Your trend rule is off right now, so this wouldn't apply. This shows what happens if you turn on ${name}.`
      : "";
  const steps: ScenarioStep[] = [
    {
      time: clock(3, OPEN_MINUTES),
      title: "Just after the open or a restart",
      body: `${name} needs ${period} one-minute bars to work out. Right after the open, or after the trader restarts, the bot only has a few.`,
      frame: { kind: "chart", prices, volumes, cursor: 3, ema: { values: line, label: name } },
    },
    {
      time: clock(ready - 1, OPEN_MINUTES),
      title: "Not enough history yet",
      body: `With ${ready} bars the line can't be drawn. Jev says BUY, but the bot can't tell whether price is above ${name}, so it skips rather than guess. ${logged("ema_warming_up")}${offNote}`,
      frame: {
        kind: "chart",
        prices,
        volumes,
        cursor: ready - 1,
        ema: { values: line, label: name },
        windowBand: { fromIndex: 0, toIndex: ready - 1, label: "Warming up" },
        marker: { index: ready - 1, label: "Skipped", tone: "bad" },
      },
    },
    {
      time: clock(ready + 2, OPEN_MINUTES),
      title: "The line appears",
      body: `After ${period} bars ${name} exists and the normal check takes over. Nothing to fix: this clears on its own.`,
      frame: { kind: "chart", prices, volumes, cursor: ready + 2, ema: { values: line, label: name } },
    },
  ];
  return {
    id: "ema_warming_up",
    title: skipReasonLabel("ema_warming_up"),
    summary: "Jev says BUY, but the bot hasn't seen enough minutes to work out the trend line.",
    steps,
  };
}

function maxEntriesScenario(settings: SkipSettings): Scenario {
  const configured = settings.max_entries_per_symbol_per_day ?? STRATEGY_FILTER_THRESHOLDS.maxEntriesPerSymbolPerDay;
  const off = configured <= 0;
  const cap = off ? STRATEGY_FILTER_THRESHOLDS.maxEntriesPerSymbolPerDay : configured;
  const offNote = off
    ? " Your daily entry limit is off right now, so the bot wouldn't skip here. This shows what happens if you set one."
    : "";
  const entries =
    cap > 4
      ? [{ label: `Entries 1 to ${cap}`, detail: `${cap} trades in AAPL so far today`, state: "pass" as const }]
      : Array.from({ length: cap }, (_, i) => ({
          label: `Entry ${i + 1}`,
          detail: `AAPL trade ${i + 1} of ${cap} today`,
          state: "pass" as const,
        }));
  return {
    id: "max_entries_per_symbol",
    title: skipReasonLabel("max_entries_per_symbol"),
    summary: "The bot already traded this symbol as many times as you allow today.",
    steps: [
      {
        time: clock(180, OPEN_MINUTES),
        title: "Already traded it today",
        body: `Your limit is ${cap} entr${cap === 1 ? "y" : "ies"} per symbol per day. The bot has already opened and closed ${cap} in AAPL.`,
        frame: { kind: "checklist", checks: entries },
      },
      {
        time: clock(185, OPEN_MINUTES),
        title: "One more BUY, but no room",
        body: `Jev rates AAPL a BUY again. The limit stops the bot from chasing one stock all day. ${logged("max_entries_per_symbol")}${offNote}`,
        frame: {
          kind: "checklist",
          checks: [
            ...entries,
            { label: "Daily entry limit", detail: `${cap} of ${cap} used`, state: "fail" },
          ],
          outcome: { tone: "bad", text: `Skipped. Logged on Predictions as "${skipReasonLabel("max_entries_per_symbol")}".` },
        },
      },
      {
        time: clock(0, 9 * 60 + 30),
        title: "Resets tomorrow",
        body: "The count starts again at zero on the next trading day, so AAPL can be traded again then.",
        frame: {
          kind: "checklist",
          checks: [
            { label: "New trading day", detail: `Entries for AAPL: 0 of ${cap}`, state: "pass" },
            { label: "Other filters", detail: "Jev and your entry filters still have to pass", state: "pending" },
          ],
        },
      },
    ],
  };
}

function cooldownScenario(settings: SkipSettings): Scenario {
  const configured = settings.reentry_cooldown_minutes ?? 45;
  const off = configured <= 0;
  const cooldown = Math.max(1, Math.round(off ? 45 : configured));
  const exit = 6;
  const n = exit + cooldown + 4;
  const prices = flatPrices(n, 215.4);
  const volumes = steadyVolumes(n);
  const early = exit + Math.max(1, Math.min(cooldown - 1, Math.round(cooldown / 3)));
  const remaining = cooldown - (early - exit);
  const after = exit + cooldown + 2;
  const offNote = off
    ? " Your cooldown is off right now, so the bot wouldn't skip here. This shows what happens if you set one."
    : "";
  const band = { fromIndex: exit, toIndex: Math.min(n - 1, exit + cooldown), label: `${cooldown}-min cooldown` };
  return {
    id: "reentry_cooldown",
    title: skipReasonLabel("reentry_cooldown"),
    summary: "The bot just sold this stock and is waiting before it buys it again.",
    steps: [
      {
        time: clock(exit, OPEN_MINUTES),
        title: "The bot exits a trade",
        body: `The bot closes its MSFT trade. Your cooldown is ${cooldown} minutes: after any exit, it waits that long before opening MSFT again.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: exit,
          markers: [{ index: exit, label: "Exit", tone: "neutral" }],
          windowBand: band,
        },
      },
      {
        time: clock(early, OPEN_MINUTES),
        title: "A BUY inside the wait",
        body: `Jev rates MSFT a BUY again, with about ${remaining} minute${remaining === 1 ? "" : "s"} of cooldown left. It stops the bot from buying straight back in on every wobble. ${logged("reentry_cooldown")}${offNote}`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: early,
          markers: [
            { index: exit, label: "Exit", tone: "neutral" },
            { index: early, label: "Skipped", tone: "bad" },
          ],
          windowBand: band,
        },
      },
      {
        time: clock(after, OPEN_MINUTES),
        title: "Cooldown over",
        body: "Once the wait is up, MSFT is treated like any other name. A fresh BUY can pass the usual checks.",
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: after,
          markers: [{ index: after, label: "Allowed", tone: "good" }],
          windowBand: band,
        },
      },
    ],
  };
}

function spreadScenario(settings: SkipSettings): Scenario {
  const configuredCap = settings.max_spread_pct ?? 0;
  const capPct = (configuredCap > 0 ? configuredCap : STRATEGY_FILTER_THRESHOLDS.maxSpreadPct) * 100;
  // Price high enough that a one-cent spread still fits under the cap.
  const mid = Math.max(200, Math.ceil(2 / capPct));
  const bidFor = (dollars: number) => round2(mid - dollars / 2);
  const askFor = (dollars: number) => round2(mid + dollars / 2);
  const pctFor = (dollars: number) => (dollars / mid) * 100;
  let wide = Math.max(0.02, round2((mid * capPct * 2.2) / 100));
  while (pctFor(wide) <= capPct) wide = round2(wide + 0.01);
  const narrow = Math.max(0.01, round2((mid * capPct * 0.4) / 100));
  const frame = (dollars: number) => ({
    kind: "quote" as const,
    symbol: "TSLA",
    bid: bidFor(dollars),
    ask: askFor(dollars),
    spreadPct: pctFor(dollars),
    capPct,
  });
  return {
    id: "spread_too_wide",
    title: skipReasonLabel("spread_too_wide"),
    summary: "The gap between buyers and sellers is too wide for a clean fill.",
    steps: [
      {
        time: clock(95, OPEN_MINUTES),
        title: "A wide gap",
        body: `The spread is the gap between the best price a buyer offers and the best price a seller wants. Here it's ${pctFor(wide).toFixed(2)}% of the price. You allow up to ${capPct.toFixed(2)}%.`,
        frame: frame(wide),
      },
      {
        time: clock(95, OPEN_MINUTES),
        title: "Skipped, even with a BUY",
        body: `A wide gap means paying more than the quoted price the moment you buy. ${logged("spread_too_wide")}`,
        frame: {
          kind: "checklist",
          checks: [
            { label: "Jev says BUY", detail: "Above your minimum confidence", state: "pass" },
            { label: "Spread", detail: `${pctFor(wide).toFixed(2)}% is over your ${capPct.toFixed(2)}% limit`, state: "fail" },
          ],
          outcome: { tone: "bad", text: `Skipped. Logged on Predictions as "${skipReasonLabel("spread_too_wide")}".` },
        },
      },
      {
        time: clock(97, OPEN_MINUTES),
        title: "The gap tightens",
        body: `Two minutes later the spread is ${pctFor(narrow).toFixed(2)}%, inside your limit, so this check passes.`,
        frame: frame(narrow),
      },
    ],
  };
}

function rsiScenario(settings: SkipSettings): Scenario {
  const configuredCap = settings.max_rsi ?? STRATEGY_FILTER_THRESHOLDS.maxRsi;
  // RSI can't pass 100, so a cap that high never skips: illustrate with the default cap.
  const unreachable = configuredCap >= 95;
  const cap = unreachable ? STRATEGY_FILTER_THRESHOLDS.maxRsi : configuredCap;
  const breakoutCap = settings.breakout_max_rsi ?? 82;
  const hot = Math.min(100, cap + 6);
  const cool = Math.max(1, cap - 12);
  const n = 24;
  const peak = 19;
  const prices = Array.from({ length: n }, (_, i) =>
    round2(i <= peak ? 38 + 0.28 * i : 38 + 0.28 * peak - 0.2 * (i - peak)),
  );
  const volumes = steadyVolumes(n);
  const rsi = (value: number) => ({ value, normalCap: cap, breakoutCap: null, activeCap: cap });
  const capNote = unreachable
    ? ` Your Max RSI of ${configuredCap} is too high for this check to ever skip. This example uses ${cap} to show how it works.`
    : "";
  const breakoutNote =
    !unreachable && breakoutCap > cap
      ? ` A name that just broke out gets a higher cap of ${breakoutCap} for a short window; this one didn't.`
      : "";
  return {
    id: "rsi_overbought",
    title: skipReasonLabel("rsi_overbought"),
    summary: "The stock has run up fast, so the bot won't chase it.",
    steps: [
      {
        time: clock(peak, OPEN_MINUTES),
        title: "A fast run-up",
        body: "RSI is a 0-to-100 score of how stretched recent momentum is. After a quick climb it gets high, which often comes before a pullback.",
        frame: { kind: "chart", prices, volumes, cursor: peak, rsi: rsi(hot) },
      },
      {
        time: clock(peak, OPEN_MINUTES),
        title: "Over your RSI cap",
        body: `RSI is ${hot} and your Max RSI is ${cap}. Jev says BUY, but the bot skips instead of buying the top.${breakoutNote}${capNote} ${logged("rsi_overbought")}`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: peak,
          rsi: rsi(hot),
          marker: { index: peak, label: "Skipped", tone: "bad" },
        },
      },
      {
        time: clock(n - 1, OPEN_MINUTES),
        title: "Momentum cools off",
        body: `After the price eases back RSI drops to ${cool}, under your cap, so this check passes if Jev still likes it.`,
        frame: { kind: "chart", prices, volumes, cursor: n - 1, rsi: rsi(cool) },
      },
    ],
  };
}

function benchmarkScenario(settings: SkipSettings): Scenario {
  const symbol = settings.benchmark_symbol?.trim().toUpperCase() || "the benchmark";
  const limit = STRATEGY_FILTER_THRESHOLDS.maxBenchmarkDrop5mPct;
  const b = 14;
  const prices = flatPrices(b + 6, 520);
  prices[b] = round2(prices[b - 5]! * (1 + (limit - 0.1) / 100));
  const end = b + 4;
  prices[end] = prices[b - 1]!;
  for (let i = b + 1; i < end; i += 1) {
    prices[i] = round2(prices[b]! + ((prices[end]! - prices[b]!) * (i - b)) / (end - b));
  }
  const volumes = steadyVolumes(prices.length);
  const drop = changePct(prices, b, 5);
  const back = changePct(prices, end, 5);
  return {
    id: "benchmark_headwind",
    title: skipReasonLabel("benchmark_headwind"),
    summary: "The wider market is dropping, so the bot holds off on new buys.",
    steps: [
      {
        time: clock(b - 1, OPEN_MINUTES),
        title: "Watching the market too",
        body: `Besides each stock, the bot tracks ${symbol} as a read on the whole market. Buying while the market falls is swimming against the current.`,
        frame: { kind: "chart", prices, volumes, cursor: b - 1 },
      },
      {
        time: clock(b, OPEN_MINUTES),
        title: "The market drops fast",
        body: `${symbol} is down ${signedPct(drop)} over 5 minutes, past the built-in limit of ${signedPct(limit)}. Jev says BUY on a stock, but the bot waits. ${logged("benchmark_headwind")}`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: b,
          marker: { index: b, label: `${signedPct(drop)} in 5m`, tone: "bad" },
        },
      },
      {
        time: clock(end, OPEN_MINUTES),
        title: "The market steadies",
        body: `A few minutes later ${symbol} is at ${signedPct(back)} over 5 minutes, back inside the limit. New buys can pass this check again.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: end,
          marker: { index: end, label: "Back in range", tone: "good" },
        },
      },
    ],
  };
}

/** Missing columns (or a missing settings row) fall back to the same defaults the trader uses. */
export function buildSkipScenarios(settings: SkipSettings | null): Scenario[] {
  settings = settings ?? {};
  return [
    volumeScenario(settings),
    belowEmaScenario(settings),
    warmingUpScenario(settings),
    maxEntriesScenario(settings),
    cooldownScenario(settings),
    spreadScenario(settings),
    rsiScenario(settings),
    benchmarkScenario(settings),
  ];
}
