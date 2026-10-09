import { entryEmaGateLabel, normalizeEntryEmaGate } from "@/lib/entry-ema-gate";
import { skipReasonLabel } from "@/lib/skip-reason-stats";
import type { Settings } from "@/lib/types/database";

/**
 * Illustrative walkthroughs for the Strategy page. Prices and symbols are made up;
 * thresholds come from the user's current settings so the numbers match their bot.
 */

export type ChartFrame = {
  kind: "chart";
  /** One close per minute. */
  prices: number[];
  volumes: number[];
  /** Last minute drawn; later minutes stay hidden so the chart "plays" forward. */
  cursor: number;
  priorHigh?: { value: number; fromIndex: number; toIndex: number; label: string };
  spikeIndex?: number;
  windowBand?: { fromIndex: number; toIndex: number; label: string };
  marker?: { index: number; label: string; tone: Tone };
  rsi?: { value: number; normalCap: number; breakoutCap: number | null; activeCap: number };
};

export type ChipState =
  | "normal"
  | "open"
  | "confirming"
  | "breakout"
  | "weakest"
  | "dropped"
  | "added";

export type ChipsFrame = {
  kind: "chips";
  chips: { symbol: string; state: ChipState }[];
  incoming?: { symbol: string; state: "waiting" | "added" | "skipped"; label: string };
  caption?: string;
};

export type CheckState = "pass" | "fail" | "pending" | "skip";

export type ChecklistFrame = {
  kind: "checklist";
  checks: { label: string; detail: string; state: CheckState }[];
  outcome?: { tone: Tone; text: string };
};

export type Tone = "good" | "bad" | "neutral";
export type ScenarioFrame = ChartFrame | ChipsFrame | ChecklistFrame;

export type ScenarioStep = {
  time: string;
  title: string;
  body: string;
  frame: ScenarioFrame;
};

export type Scenario = {
  id: "breakout" | "steady" | "full-list" | "buy-flow";
  title: string;
  summary: string;
  steps: ScenarioStep[];
};

export const SCENARIO_DISCLAIMER =
  "Illustrative example: made-up symbols and prices, your current settings.";

const ACTIVE_SYMBOLS = [
  "AAPL", "MSFT", "NVDA", "META", "AMZN", "GOOGL", "TSLA", "AVGO", "NFLX", "ORCL",
  "CRM", "ADBE", "CSCO", "PEP", "WMT", "COST", "DIS", "PYPL", "INTC", "IBM",
];

const VOLUME_WIGGLE = [0, 900, -600, 1500, 300, -900, 600, -300];
const PRICE_WIGGLE = [0, 0.12, 0.05, 0.2, 0.1, 0.24, 0.14, 0.3, 0.18, 0.08];

function clampInt(value: number | null | undefined, min: number, max: number, fallback: number) {
  const n = Number.isFinite(value) ? Math.round(value as number) : fallback;
  return Math.min(max, Math.max(min, n));
}

function clock(minutesAfterTen: number): string {
  const total = 10 * 60 + minutesAfterTen;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function usd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function signedPct(value: number, digits = 2): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function wholePct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

function changePct(prices: number[], index: number, minutes: number): number {
  const past = prices[Math.max(0, index - minutes)]!;
  return ((prices[index]! - past) / past) * 100;
}

/** Active list for the examples, with the weakest (lowest-ranked) name last. */
export function exampleActiveList(size: number): string[] {
  return ACTIVE_SYMBOLS.slice(0, clampInt(size, 4, 16, 12));
}

type Shared = {
  normalCap: number;
  breakoutCap: number;
  loosened: boolean;
  lookback: number;
  windowMinutes: number;
  volumeRatioMin: number;
  change5mMin: number;
  maxAtOnce: number;
  activeSize: number;
  rotationInterval: number;
  maxSwaps: number;
  sessionFloor: number | null;
  benchmark: string;
};

function shared(settings: Settings): Shared {
  const normalCap = settings.max_rsi ?? 70;
  const breakoutCap = settings.breakout_max_rsi ?? 82;
  return {
    normalCap,
    breakoutCap,
    loosened: breakoutCap > normalCap,
    lookback: clampInt(settings.breakout_lookback_minutes, 5, 60, 10),
    windowMinutes: clampInt(settings.breakout_window_minutes, 1, 60, 10),
    volumeRatioMin: settings.breakout_min_volume_ratio ?? 1.5,
    change5mMin: settings.breakout_min_change_5m_pct ?? 0.15,
    maxAtOnce: clampInt(settings.breakout_max_promotions_per_cycle, 1, 5, 2),
    activeSize: clampInt(settings.watchlist_active_size, 4, 16, 12),
    rotationInterval: clampInt(settings.watchlist_rotation_interval_minutes, 1, 120, 15),
    maxSwaps: clampInt(settings.watchlist_max_swaps_per_rotation, 1, 12, 2),
    sessionFloor: settings.rotation_min_session_change_pct ?? null,
    benchmark: settings.benchmark_symbol?.trim().toUpperCase() || "the benchmark",
  };
}

/** RSI used in the breakout entry step: above the normal cap, within the breakout cap when it is higher. */
export function breakoutExampleRsi(normalCap: number, breakoutCap: number): number {
  if (breakoutCap > normalCap) {
    const gap = breakoutCap - normalCap;
    return normalCap + Math.min(gap, Math.max(1, Math.round(gap / 2)));
  }
  return Math.min(100, normalCap + 3);
}

function breakoutScenario(s: Shared): Scenario {
  const quiet = s.lookback + 4;
  const prices: number[] = [];
  for (let i = 0; i < quiet; i += 1) {
    prices.push(round2(186.5 + PRICE_WIGGLE[i % PRICE_WIGGLE.length]!));
  }
  const b = quiet;
  const priorWindow = prices.slice(b - s.lookback, b);
  const priorHigh = Math.max(...priorWindow);
  const targetMove = Math.max(0.3, s.change5mMin * 2 + 0.1);
  const breakoutPrice = round2(
    Math.max(priorHigh + 0.25, prices[b - 5]! * (1 + targetMove / 100)),
  );
  prices.push(breakoutPrice);
  const tail = s.windowMinutes + 3;
  for (let k = 1; k <= tail; k += 1) {
    prices.push(round2(breakoutPrice + 0.04 * k + (k % 3 === 0 ? -0.06 : 0)));
  }

  const volumes = prices.map((_, i) => 12_000 + VOLUME_WIGGLE[i % VOLUME_WIGGLE.length]!);
  const baseline = mean(volumes.slice(b - s.lookback, b));
  volumes[b] = Math.round(baseline * (s.volumeRatioMin + 0.6));
  for (let k = 1; k <= tail; k += 1) {
    volumes[b + k] = Math.round(baseline * Math.max(1, 1.6 - k * 0.1));
  }
  const ratio = volumes[b]! / baseline;
  const change5 = changePct(prices, b, 5);
  const benchChange = change5 / 2;

  const windowEnd = b + s.windowMinutes;
  const rsi = breakoutExampleRsi(s.normalCap, s.breakoutCap);
  const priorHighMark = {
    value: priorHigh,
    fromIndex: b - s.lookback,
    toIndex: b - 1,
    label: `${s.lookback}-min high ${usd(priorHigh)}`,
  };
  const active = exampleActiveList(s.activeSize);
  const weakest = active[active.length - 1]!;
  const sessionLine =
    s.sessionFloor == null ? "" : " It's also green since the open, so it passes your session floor.";

  return {
    id: "breakout",
    title: "Breakout promotion",
    summary: "A pool name surges and jumps onto the active list right away.",
    steps: [
      {
        time: clock(quiet - 1),
        title: "Quiet in the pool",
        body: `QCOM is in your pool but not on the active list, so Jev isn't scoring it yet. The bot still watches its price and volume every cycle. The shaded area is the last ${s.lookback} minutes the breakout check looks back over.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: b - 1,
          priorHigh: priorHighMark,
        },
      },
      {
        time: clock(b),
        title: "It breaks out",
        body: `Price jumps to ${usd(breakoutPrice)}, above the ${s.lookback}-minute high of ${usd(priorHigh)}. Volume is ${ratio.toFixed(1)}× the recent average (needs ${s.volumeRatioMin}×). It's up ${signedPct(change5)} in 5 minutes (needs ${signedPct(s.change5mMin)}) and beats ${s.benchmark} at ${signedPct(benchChange)}.${sessionLine}`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: b,
          priorHigh: priorHighMark,
          spikeIndex: b,
          marker: { index: b, label: "Breakout", tone: "good" },
        },
      },
      {
        time: clock(b),
        title: "Promoted to the active list",
        body: `Your active list is full (${s.activeSize} names), so the lowest-ranked name that isn't protected, ${weakest}, makes room. QCOM gets a ${s.windowMinutes}-minute breakout window: rotation can't swap it out during that time.`,
        frame: {
          kind: "chips",
          chips: [
            ...active.slice(0, -1).map((symbol) => ({ symbol, state: "normal" as ChipState })),
            { symbol: weakest, state: "dropped" },
            { symbol: "QCOM", state: "breakout" },
          ],
          incoming: { symbol: "QCOM", state: "added", label: "Added early" },
        },
      },
      {
        time: clock(b + 2),
        title: "Jev says BUY: the RSI check",
        body: s.loosened
          ? `RSI is ${rsi}. Your normal Max RSI of ${s.normalCap} would block it, but inside the breakout window the cap is ${s.breakoutCap}, so this check passes. Jev's BUY and your other filters still have to pass too.`
          : `RSI is ${rsi}. Your Breakout max RSI (${s.breakoutCap}) isn't above Max RSI (${s.normalCap}), so the cap stays at ${s.normalCap} and this entry is blocked. The promotion only got QCOM onto the list sooner.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: b + 2,
          spikeIndex: b,
          windowBand: { fromIndex: b, toIndex: windowEnd, label: `${s.windowMinutes}-min window` },
          rsi: {
            value: rsi,
            normalCap: s.normalCap,
            breakoutCap: s.loosened ? s.breakoutCap : null,
            activeCap: s.loosened ? s.breakoutCap : s.normalCap,
          },
        },
      },
      {
        time: clock(windowEnd),
        title: "Window ends",
        body: `After ${s.windowMinutes} minutes QCOM is treated like any other active name. The RSI cap goes back to ${s.normalCap}, and the next rotation scan can swap it out if it ranks low.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: Math.min(prices.length - 1, windowEnd),
          spikeIndex: b,
          windowBand: { fromIndex: b, toIndex: windowEnd, label: "Window over" },
          rsi: {
            value: rsi,
            normalCap: s.normalCap,
            breakoutCap: null,
            activeCap: s.normalCap,
          },
        },
      },
    ],
  };
}

function steadyScenario(s: Shared, settings: Settings): Scenario {
  const length = s.lookback + 6;
  const last = length - 1;
  const peakIndex = last - Math.floor(s.lookback / 2);
  const dipIndex = peakIndex + Math.max(1, Math.floor((last - peakIndex) / 2));
  const prices: number[] = [];
  for (let i = 0; i < length; i += 1) {
    let price: number;
    if (i <= peakIndex) price = 160 + 2.55 * (i / peakIndex);
    else if (i <= dipIndex) price = 162.55 - 0.55 * ((i - peakIndex) / (dipIndex - peakIndex));
    else price = 162.0 + 0.3 * ((i - dipIndex) / Math.max(1, last - dipIndex));
    prices.push(round2(price));
  }
  const volumes = prices.map((_, i) => 9_000 + VOLUME_WIGGLE[i % VOLUME_WIGGLE.length]!);
  const priorWindow = prices.slice(last - s.lookback, last);
  const priorHigh = Math.max(...priorWindow);
  const ratio = volumes[last]! / mean(volumes.slice(last - s.lookback, last));
  const change5 = changePct(prices, last, 5);
  const sessionChange = ((prices[last]! - 160) / 160) * 100;
  const gate = normalizeEntryEmaGate(settings.entry_ema_gate);
  const trendRule = gate === "off" ? "" : `, your trend rule (${entryEmaGateLabel(gate)})`;
  const active = exampleActiveList(s.activeSize);
  const weakest = active[active.length - 1]!;
  const scanAt = s.rotationInterval;
  const checkAt = Math.max(1, scanAt - 8);

  return {
    id: "steady",
    title: "Steady climber",
    summary: "No surge, so no breakout. The 15-minute rotation picks it up instead.",
    steps: [
      {
        time: clock(checkAt),
        title: "Climbing, but no surge",
        body: `AMD has risen steadily all morning, but right now it sits at ${usd(prices[last]!)}, just under its ${s.lookback}-minute high of ${usd(priorHigh)}, on ordinary volume.`,
        frame: {
          kind: "chart",
          prices,
          volumes,
          cursor: last,
          priorHigh: {
            value: priorHigh,
            fromIndex: last - s.lookback,
            toIndex: last - 1,
            label: `${s.lookback}-min high ${usd(priorHigh)}`,
          },
        },
      },
      {
        time: clock(checkAt),
        title: "Breakout check fails",
        body: "The breakout check needs every line to pass. AMD fails two, so it stays in the pool. Nothing is wrong with it; it just isn't surging.",
        frame: {
          kind: "checklist",
          checks: [
            {
              label: "New high",
              detail: `${usd(prices[last]!)} is below the ${s.lookback}-minute high of ${usd(priorHigh)}`,
              state: "fail",
            },
            {
              label: "Volume spike",
              detail: `${ratio.toFixed(1)}× the recent average (needs ${s.volumeRatioMin}×)`,
              state: ratio >= s.volumeRatioMin ? "pass" : "fail",
            },
            {
              label: "5-minute move",
              detail: `${signedPct(change5)} (needs ${signedPct(s.change5mMin)})`,
              state: change5 >= s.change5mMin ? "pass" : "fail",
            },
            s.sessionFloor == null
              ? { label: "Green since the open", detail: "Session floor is off in your settings", state: "skip" }
              : {
                  label: "Green since the open",
                  detail: `${signedPct(sessionChange, 1)} since the open (floor ${signedPct(s.sessionFloor, 1)})`,
                  state: sessionChange >= s.sessionFloor ? "pass" : "fail",
                },
          ],
          outcome: { tone: "neutral", text: "Not promoted. AMD waits for the next rotation scan." },
        },
      },
      {
        time: clock(scanAt),
        title: "Rotation scan picks it up",
        body: `Every ${s.rotationInterval} minutes, rotation ranks all pool names on recent move, volume, RSI${trendRule} and the session floor. AMD ranks well and ${weakest} has gone flat, so they swap. Rotation makes up to ${s.maxSwaps} swaps per scan.`,
        frame: {
          kind: "chips",
          chips: [
            ...active.slice(0, -1).map((symbol) => ({ symbol, state: "normal" as ChipState })),
            { symbol: weakest, state: "dropped" },
            { symbol: "AMD", state: "added" },
          ],
          incoming: { symbol: "AMD", state: "added", label: "Rotation swap" },
        },
      },
      {
        time: clock(scanAt + 1),
        title: "Normal rules from here",
        body: "AMD came in through rotation, so it gets no breakout window. It follows the same rules as every other active name.",
        frame: {
          kind: "checklist",
          checks: [
            {
              label: "RSI cap",
              detail: `Your normal Max RSI of ${s.normalCap} applies`,
              state: "pass",
            },
            {
              label: "Rotation protection",
              detail: "None: the next scan can swap it out if it slips down the ranking",
              state: "skip",
            },
            {
              label: "Entry",
              detail: "Jev still has to say BUY and your entry filters still have to pass",
              state: "pending",
            },
          ],
        },
      },
    ],
  };
}

function fullListScenario(s: Shared, settings: Settings): Scenario {
  const active = exampleActiveList(s.activeSize);
  const size = active.length;
  const maxOpen = clampInt(settings.max_open_positions, 1, size, 3);
  const openCount = Math.min(2, maxOpen);
  const existingBreakouts = s.maxAtOnce >= 2 ? 1 : 0;
  const weakest = active[size - 1]!;

  const base: ChipState[] = active.map((_, i) => {
    if (i < openCount) return "open";
    if (i === openCount) return "confirming";
    if (i < openCount + 1 + existingBreakouts) return "breakout";
    return "normal";
  });

  const allProtected: ChipState[] = active.map((_, i) => {
    if (i < maxOpen) return "open";
    if (i < maxOpen + Math.max(0, s.maxAtOnce - 1)) return "breakout";
    return "confirming";
  });

  const capReached: ChipState[] = active.map((_, i) => {
    if (i < openCount) return "open";
    if (i < openCount + s.maxAtOnce) return "breakout";
    return "normal";
  });

  const chips = (states: ChipState[]) =>
    active.map((symbol, i) => ({ symbol, state: states[i]! }));

  return {
    id: "full-list",
    title: "Full list",
    summary: "What a breakout replaces when every slot is taken.",
    steps: [
      {
        time: clock(42),
        title: "The list is full",
        body: `All ${size} slots are taken and QCOM is breaking out. Some names are protected and can't be removed: ones with an open trade, ones waiting for entry confirmation, and ones inside their own breakout window.`,
        frame: {
          kind: "chips",
          chips: chips(base.map((state, i) => (i === size - 1 ? "weakest" : state))),
          incoming: { symbol: "QCOM", state: "waiting", label: "Breaking out" },
          caption: `${weakest} ranks lowest of the unprotected names.`,
        },
      },
      {
        time: clock(42),
        title: "The weakest unprotected name makes room",
        body: `The bot scores the unprotected names the same way rotation does and drops the lowest, ${weakest}. QCOM doesn't have to beat ${weakest}'s score: a valid breakout always takes the weakest spot. Rotation can bring ${weakest} back later if it ranks well.`,
        frame: {
          kind: "chips",
          chips: [
            ...chips(base).slice(0, -1),
            { symbol: weakest, state: "dropped" },
            { symbol: "QCOM", state: "breakout" },
          ],
          incoming: { symbol: "QCOM", state: "added", label: "Added early" },
        },
      },
      {
        time: clock(42),
        title: "If every name is protected",
        body: "Rare, but possible: every slot has an open trade, a pending confirmation or a breakout window. Then there's nothing to drop and QCOM is skipped. The bot checks again every cycle and promotes it once a slot frees up, if it's still breaking out.",
        frame: {
          kind: "chips",
          chips: chips(allProtected),
          incoming: { symbol: "QCOM", state: "skipped", label: "No room" },
        },
      },
      {
        time: clock(42),
        title: "If the breakout limit is reached",
        body: `Your limit is ${s.maxAtOnce} breakout name${s.maxAtOnce === 1 ? "" : "s"} inside a window at once. When that many are already active, QCOM waits even if there's room, so a broad rally can't replace your whole list.`,
        frame: {
          kind: "chips",
          chips: chips(capReached),
          incoming: { symbol: "QCOM", state: "waiting", label: "Waiting for a window to end" },
        },
      },
    ],
  };
}

function buyFlowScenario(s: Shared, settings: Settings): Scenario {
  const minConfidence = settings.minimum_jev_confidence ?? 0.85;
  const buy = Math.min(0.97, Math.max(0.88, minConfidence + 0.03));
  const cycles = Math.max(1, settings.confirmation_cycles ?? 2);
  const seconds = settings.confirmation_seconds ?? 30;
  const gate = normalizeEntryEmaGate(settings.entry_ema_gate);
  const spreadCapPct = (settings.max_spread_pct ?? 0.0015) * 100;
  const spreadPct = Math.min(0.04, spreadCapPct / 2);
  const maxOpen = settings.max_open_positions ?? 3;
  const openNow = Math.max(0, Math.min(maxOpen - 1, 2));
  const goodRsi = Math.max(1, s.normalCap - 10);
  const hotRsi = Math.min(100, s.normalCap + 6);

  const jev = {
    label: "Jev says BUY",
    detail: `BUY ${wholePct(buy)}, at or above your ${wholePct(minConfidence)} minimum`,
    state: "pass" as CheckState,
  };
  const confirm = {
    label: "Confirmation",
    detail: `The BUY holds for ${cycles} cycle${cycles === 1 ? "" : "s"}${seconds > 0 ? ` and ${seconds}s` : ""}`,
    state: "pass" as CheckState,
  };
  const ema =
    gate === "off"
      ? { label: "Trend filter", detail: "Off in your settings", state: "skip" as CheckState }
      : { label: "Trend filter", detail: `${entryEmaGateLabel(gate)}: yes`, state: "pass" as CheckState };
  const rsiPass = {
    label: "RSI",
    detail: `RSI ${goodRsi} is under your cap of ${s.normalCap}`,
    state: "pass" as CheckState,
  };
  const spread = {
    label: "Spread",
    detail: `${spreadPct.toFixed(2)}% of price, under your ${spreadCapPct.toFixed(2)}% limit`,
    state: "pass" as CheckState,
  };
  const risk = {
    label: "Risk caps",
    detail: `${openNow} of ${maxOpen} positions open; under the daily entry limit; no cooldown`,
    state: "pass" as CheckState,
  };
  const pending = <T extends { state: CheckState }>(check: T): T => ({ ...check, state: "pending" });

  return {
    id: "buy-flow",
    title: "BUY to trade or skip",
    summary: "Every check a BUY signal has to pass before the bot opens a trade.",
    steps: [
      {
        time: clock(65),
        title: "Jev scores the stock",
        body: `Jev rates MSFT ${wholePct(buy)} BUY. That's at or above your minimum confidence of ${wholePct(minConfidence)}, so the bot keeps going. Below it, the signal is only logged.`,
        frame: {
          kind: "checklist",
          checks: [jev, pending(confirm), pending(ema), pending(rsiPass), pending(spread), pending(risk)],
        },
      },
      {
        time: clock(65),
        title: "Confirmation",
        body: "One strong reading isn't enough. The BUY has to hold across your confirmation cycles, which filters out one-tick flickers.",
        frame: {
          kind: "checklist",
          checks: [jev, confirm, pending(ema), pending(rsiPass), pending(spread), pending(risk)],
        },
      },
      {
        time: clock(66),
        title: "Entry filters",
        body: "Now the hard filters from your settings: the trend rule, RSI and spread. Every one has to pass.",
        frame: {
          kind: "checklist",
          checks: [jev, confirm, ema, rsiPass, spread, pending(risk)],
        },
      },
      {
        time: clock(66),
        title: "Risk caps, then the trade",
        body: "Last, the risk caps: open position limit, daily entries per symbol and the cooldown after an exit. All clear, so the bot places the order with a stop-loss and take-profit from your risk settings.",
        frame: {
          kind: "checklist",
          checks: [jev, confirm, ema, rsiPass, spread, risk],
          outcome: {
            tone: "good",
            text: "Trade placed. Size comes from your risk per trade and stop-loss distance.",
          },
        },
      },
      {
        time: clock(66),
        title: "Same signal, RSI too high",
        body: `If RSI had been ${hotRsi}, above your cap of ${s.normalCap}, the trade would be skipped even with a strong BUY.${s.loosened ? ` A breakout name inside its window would get the higher cap of ${s.breakoutCap} instead.` : ""} The skip is logged on Predictions with its reason.`,
        frame: {
          kind: "checklist",
          checks: [
            jev,
            confirm,
            ema,
            { label: "RSI", detail: `RSI ${hotRsi} is above your cap of ${s.normalCap}`, state: "fail" },
            { ...spread, state: "skip", detail: "Doesn't matter: one failed filter is enough to skip" },
            { ...risk, state: "skip", detail: "Not reached" },
          ],
          outcome: {
            tone: "bad",
            text: `Skipped. Logged on Predictions as "${skipReasonLabel("rsi_overbought")}".`,
          },
        },
      },
    ],
  };
}

export function buildScenarios(settings: Settings): Scenario[] {
  const s = shared(settings);
  return [
    breakoutScenario(s),
    steadyScenario(s, settings),
    fullListScenario(s, settings),
    buyFlowScenario(s, settings),
  ];
}
