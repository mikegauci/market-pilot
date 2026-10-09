import type { QuoteFrame } from "@/lib/strategy-scenarios";

const W = 360;

export function ScenarioQuote({ frame }: { frame: QuoteFrame }) {
  const passes = frame.spreadPct <= frame.capPct;
  const color = passes ? "#34d399" : "#f87171";
  const scaleMax = Math.max(frame.capPct, frame.spreadPct) * 1.4;
  const gx = (value: number) => 20 + (value / scaleMax) * (W - 40);

  return (
    <svg
      viewBox={`0 0 ${W} 150`}
      className="h-auto w-full"
      role="img"
      aria-label="Illustrative bid, ask and spread for this step"
    >
      <text x="20" y="22" fill="#e4e4e7" fontSize="11" fontWeight="600">
        {frame.symbol}
      </text>
      <g fontSize="9">
        <text x="20" y="48" fill="#71717a">Bid (best price a buyer offers)</text>
        <text x={W - 20} y="48" fill="#e4e4e7" textAnchor="end">${frame.bid.toFixed(2)}</text>
        <text x="20" y="66" fill="#71717a">Ask (best price a seller wants)</text>
        <text x={W - 20} y="66" fill="#e4e4e7" textAnchor="end">${frame.ask.toFixed(2)}</text>
      </g>
      <text x="20" y="96" fill={color} fontSize="10" fontWeight="600">
        Spread {frame.spreadPct.toFixed(2)}% of price
      </text>
      <rect x="20" y="106" width={W - 40} height="8" rx="4" fill="#27272a" />
      <rect x="20" y="106" width={gx(frame.spreadPct) - 20} height="8" rx="4" fill={color} opacity="0.85" />
      <line x1={gx(frame.capPct)} x2={gx(frame.capPct)} y1="100" y2="120" stroke="#d4d4d8" strokeWidth="1.2" />
      <text x={gx(frame.capPct)} y="134" fill="#a1a1aa" fontSize="8" textAnchor="middle">
        Your limit {frame.capPct.toFixed(2)}%
      </text>
    </svg>
  );
}
