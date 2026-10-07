import type { StrategyDiagramType } from "@/lib/strategy-diagram-types";
import { cn } from "@/lib/utils";

export type { StrategyDiagramType };

export function TradeDecisionFlow() {
  const steps = [
    {
      label: "Market data",
      sub: "RSI, EMA, volume, news",
      color: "border-zinc-700 bg-zinc-900",
    },
    {
      label: "Jev (AI)",
      sub: "Buy, sell, or hold",
      color: "border-emerald-800/60 bg-emerald-950/30",
    },
    {
      label: "Entry filters",
      sub: "RSI, EMA, spread, news",
      color: "border-amber-800/60 bg-amber-950/30",
    },
    {
      label: "Risk caps",
      sub: "Cooldown, daily entries",
      color: "border-orange-900/50 bg-orange-950/20",
    },
    {
      label: "Trade or skip",
      sub: "Execute or log reason",
      color: "border-zinc-700 bg-zinc-900",
    },
  ];

  return (
    <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch lg:gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex flex-1 items-center gap-2 lg:gap-0">
          <div
            className={cn(
              "flex flex-1 flex-col rounded-lg border px-2.5 py-2 text-center sm:px-3 sm:py-2.5",
              step.color,
            )}
          >
            <span className="text-[11px] font-medium text-zinc-200 sm:text-xs">
              {step.label}
            </span>
            <span className="mt-0.5 text-[10px] leading-snug text-zinc-500">{step.sub}</span>
          </div>
          {i < steps.length - 1 ? (
            <span className="hidden shrink-0 px-1 text-zinc-600 lg:inline" aria-hidden>
              →
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RsiGauge() {
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[200px]" aria-hidden>
      <rect x="0" y="40" width="140" height="12" rx="2" fill="#27272a" />
      <rect x="0" y="40" width="98" height="12" rx="2" fill="#065f46" opacity="0.6" />
      <rect x="98" y="40" width="42" height="12" rx="2" fill="#854d0e" opacity="0.6" />
      <rect x="140" y="40" width="60" height="12" rx="2" fill="#7f1d1d" opacity="0.6" />
      <line x1="140" y1="34" x2="140" y2="58" stroke="#fbbf24" strokeWidth="1.5" />
      <text x="140" y="28" textAnchor="middle" fill="#fbbf24" fontSize="9">
        70
      </text>
      <text x="0" y="62" fill="#71717a" fontSize="8">
        0
      </text>
      <text x="200" y="62" textAnchor="end" fill="#71717a" fontSize="8">
        100
      </text>
    </svg>
  );
}

export function EmaTrendDiagram({ blocked = false }: { blocked?: boolean }) {
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[200px]" aria-hidden>
      <line x1="10" y1="55" x2="190" y2="55" stroke="#52525b" strokeWidth="1" strokeDasharray="4 2" />
      <text x="192" y="58" fill="#71717a" fontSize="7">
        EMA-20
      </text>
      <polyline
        points={blocked ? "10,30 50,35 90,40 130,48 170,52" : "10,50 50,45 90,38 130,32 170,25"}
        fill="none"
        stroke={blocked ? "#ef4444" : "#34d399"}
        strokeWidth="2"
      />
      <circle
        cx="170"
        cy={blocked ? 52 : 25}
        r="4"
        fill={blocked ? "#ef4444" : "#34d399"}
      />
      <text x="10" y="18" fill={blocked ? "#fca5a5" : "#6ee7b7"} fontSize="8">
        {blocked ? "Price below trend — blocked" : "Price above trend — OK"}
      </text>
    </svg>
  );
}

export function EmaWarmupDiagram() {
  const filled = 14;
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[200px]" aria-hidden>
      {Array.from({ length: 20 }).map((_, i) => (
        <rect
          key={i}
          x={10 + i * 9}
          y={38}
          width="6"
          height={22}
          rx="1"
          fill={i < filled ? "#065f46" : "#27272a"}
          opacity={i < filled ? 0.85 : 0.6}
        />
      ))}
      <text x="10" y="22" fill="#fbbf24" fontSize="8">
        Warming up — need ~20×1m bars
      </text>
      <text x="10" y="66" fill="#71717a" fontSize="7">
        {filled}/20 bars
      </text>
    </svg>
  );
}

export function SessionVsOpenDiagram({ red = false }: { red?: boolean }) {
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[200px]" aria-hidden>
      <line x1="20" y1="48" x2="180" y2="48" stroke="#52525b" strokeWidth="1.5" strokeDasharray="3 2" />
      <text x="22" y="44" fill="#71717a" fontSize="7">
        9:30 open
      </text>
      <circle cx="150" cy={red ? 58 : 32} r="5" fill={red ? "#ef4444" : "#34d399"} />
      <text x="10" y="18" fill={red ? "#fca5a5" : "#6ee7b7"} fontSize="8">
        {red ? "Red vs open — rotation penalty" : "Green vs open — OK"}
      </text>
    </svg>
  );
}

export function RotationPipelineDiagram() {
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[220px]" aria-hidden>
      <rect x="8" y="28" width="44" height="28" rx="4" fill="#27272a" stroke="#52525b" />
      <text x="30" y="46" textAnchor="middle" fill="#a1a1aa" fontSize="7">
        Pool
      </text>
      <path d="M 54 42 H 72" stroke="#71717a" strokeWidth="1.2" markerEnd="url(#arrow)" />
      <rect x="72" y="24" width="56" height="36" rx="4" fill="#18181b" stroke="#854d0e" />
      <text x="100" y="40" textAnchor="middle" fill="#fcd34d" fontSize="6">
        Score
      </text>
      <text x="100" y="50" textAnchor="middle" fill="#71717a" fontSize="5">
        5m/15m + session
      </text>
      <path d="M 130 42 H 148" stroke="#71717a" strokeWidth="1.2" />
      <rect x="148" y="28" width="44" height="28" rx="4" fill="#065f46" opacity="0.35" stroke="#34d399" />
      <text x="170" y="46" textAnchor="middle" fill="#6ee7b7" fontSize="7">
        Active
      </text>
    </svg>
  );
}

export function ReentryCooldownDiagram() {
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[200px]" aria-hidden>
      <circle cx="40" cy="40" r="10" fill="#27272a" stroke="#71717a" />
      <text x="40" y="43" textAnchor="middle" fill="#a1a1aa" fontSize="6">
        Exit
      </text>
      <rect x="70" y="32" width="60" height="16" rx="3" fill="#7f1d1d" opacity="0.5" />
      <text x="100" y="43" textAnchor="middle" fill="#fca5a5" fontSize="7">
        Cooldown
      </text>
      <circle cx="160" cy="40" r="10" fill="#065f46" opacity="0.5" stroke="#34d399" />
      <text x="160" y="43" textAnchor="middle" fill="#6ee7b7" fontSize="6">
        OK
      </text>
      <path d="M 52 40 H 68 M 132 40 H 148" stroke="#71717a" strokeWidth="1" />
    </svg>
  );
}

export function MaxEntriesDiagram({ slots = 3 }: { slots?: number }) {
  const n = Math.min(5, Math.max(1, slots));
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[200px]" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <rect
          key={i}
          x={20 + i * 36}
          y="30"
          width="28"
          height="28"
          rx="4"
          fill={i < n - 1 ? "#7f1d1d" : "#27272a"}
          stroke="#52525b"
        />
      ))}
      <text x="10" y="18" fill="#a1a1aa" fontSize="8">
        {n} entries / symbol / day max
      </text>
    </svg>
  );
}

export function VolumeRatioBar({ low = false }: { low?: boolean }) {
  const currentHeight = low ? 18 : 42;
  return (
    <svg viewBox="0 0 200 70" className="h-16 w-full max-w-[200px]" aria-hidden>
      <rect x="50" y={55 - 40} width="36" height="40" rx="2" fill="#3f3f46" />
      <text x="68" y="62" textAnchor="middle" fill="#71717a" fontSize="7">
        Avg
      </text>
      <rect
        x="110"
        y={55 - currentHeight}
        width="36"
        height={currentHeight}
        rx="2"
        fill={low ? "#7f1d1d" : "#065f46"}
        opacity="0.8"
      />
      <text x="128" y="62" textAnchor="middle" fill="#71717a" fontSize="7">
        Now
      </text>
    </svg>
  );
}

export function StrategyDiagram({
  type,
  variant,
  maxEntrySlots,
}: {
  type: StrategyDiagramType;
  variant?: "default" | "blocked" | "low";
  maxEntrySlots?: number;
}) {
  switch (type) {
    case "rsi":
      return <RsiGauge />;
    case "ema":
      return <EmaTrendDiagram blocked={variant === "blocked"} />;
    case "emaWarmup":
      return <EmaWarmupDiagram />;
    case "volume":
      return <VolumeRatioBar low={variant === "low"} />;
    case "sessionOpen":
      return <SessionVsOpenDiagram red={variant === "blocked"} />;
    case "rotation":
      return <RotationPipelineDiagram />;
    case "reentry":
      return <ReentryCooldownDiagram />;
    case "maxEntries":
      return <MaxEntriesDiagram slots={maxEntrySlots ?? 3} />;
  }
}
