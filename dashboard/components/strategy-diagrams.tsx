import { cn } from "@/lib/utils";

export function TradeDecisionFlow() {
  const steps = [
    { label: "Market data", sub: "RSI, EMA, volume, news", color: "border-zinc-700 bg-zinc-900" },
    { label: "Jev (AI)", sub: "Buy, sell, or hold", color: "border-emerald-800/60 bg-emerald-950/30" },
    { label: "Safety checks", sub: "Hard filters veto", color: "border-amber-800/60 bg-amber-950/30" },
    { label: "Trade or skip", sub: "Execute or log reason", color: "border-zinc-700 bg-zinc-900" },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch sm:gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex flex-1 items-center gap-2 sm:gap-0">
          <div
            className={cn(
              "flex flex-1 flex-col rounded-lg border px-3 py-2.5 text-center",
              step.color,
            )}
          >
            <span className="text-xs font-medium text-zinc-200">{step.label}</span>
            <span className="mt-0.5 text-[10px] text-zinc-500">{step.sub}</span>
          </div>
          {i < steps.length - 1 ? (
            <span className="hidden shrink-0 px-1.5 text-zinc-600 sm:inline" aria-hidden>
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
      <text x="70" y="62" textAnchor="middle" fill="#71717a" fontSize="7">
        OK
      </text>
      <text x="170" y="62" textAnchor="middle" fill="#71717a" fontSize="7">
        Block
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
      <text x="10" y="18" fill={low ? "#fca5a5" : "#6ee7b7"} fontSize="8">
        {low ? "Below average — risky" : "Healthy volume"}
      </text>
    </svg>
  );
}

export function StrategyDiagram({
  type,
  variant,
}: {
  type: "rsi" | "ema" | "volume";
  variant?: "default" | "blocked" | "low";
}) {
  switch (type) {
    case "rsi":
      return <RsiGauge />;
    case "ema":
      return <EmaTrendDiagram blocked={variant === "blocked"} />;
    case "volume":
      return <VolumeRatioBar low={variant === "low"} />;
  }
}
