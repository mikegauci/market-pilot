import type { ChartFrame } from "@/lib/strategy-scenarios";

const W = 360;
const PAD_X = 10;
const PRICE_TOP = 22;
const PRICE_BOTTOM = 108;
const VOLUME_TOP = 118;
const VOLUME_BOTTOM = 152;
const RSI_Y = 182;

const TONE_COLOR = { good: "#34d399", bad: "#f87171", neutral: "#a1a1aa" } as const;

export function ScenarioChart({ frame }: { frame: ChartFrame }) {
  const { prices, volumes, cursor } = frame;
  const n = prices.length;
  const height = frame.rsi ? 206 : 160;
  const step = (W - PAD_X * 2) / Math.max(1, n - 1);
  const x = (i: number) => PAD_X + i * step;

  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = (hi - lo) * 0.15 || 0.5;
  const y = (price: number) =>
    PRICE_BOTTOM - ((price - (lo - pad)) / (hi + pad - (lo - pad))) * (PRICE_BOTTOM - PRICE_TOP);

  const maxVolume = Math.max(...volumes);
  const barWidth = Math.max(1.5, step * 0.6);
  const visible = prices.slice(0, cursor + 1);
  const points = visible.map((price, i) => `${x(i).toFixed(1)},${y(price).toFixed(1)}`).join(" ");

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="h-auto w-full"
      role="img"
      aria-label="Illustrative price, volume and RSI chart for this step"
    >
      {frame.windowBand ? (
        <g>
          <rect
            x={x(frame.windowBand.fromIndex)}
            y={PRICE_TOP - 10}
            width={Math.max(2, x(Math.min(n - 1, frame.windowBand.toIndex)) - x(frame.windowBand.fromIndex))}
            height={VOLUME_BOTTOM - PRICE_TOP + 10}
            fill="#f59e0b"
            opacity="0.08"
          />
          <text x={x(frame.windowBand.fromIndex) + 3} y={PRICE_TOP - 2} fill="#fcd34d" fontSize="8">
            {frame.windowBand.label}
          </text>
        </g>
      ) : null}

      {frame.priorHigh ? (
        <g>
          <rect
            x={x(frame.priorHigh.fromIndex) - step / 2}
            y={PRICE_TOP - 10}
            width={x(frame.priorHigh.toIndex) - x(frame.priorHigh.fromIndex) + step}
            height={PRICE_BOTTOM - PRICE_TOP + 10}
            fill="#38bdf8"
            opacity="0.06"
          />
          <line
            x1={x(frame.priorHigh.fromIndex)}
            x2={x(n - 1)}
            y1={y(frame.priorHigh.value)}
            y2={y(frame.priorHigh.value)}
            stroke="#7dd3fc"
            strokeWidth="1"
            strokeDasharray="4 3"
          />
          <text
            x={x(frame.priorHigh.fromIndex) + 2}
            y={y(frame.priorHigh.value) - 4}
            fill="#7dd3fc"
            fontSize="8"
          >
            {frame.priorHigh.label}
          </text>
        </g>
      ) : null}

      <polyline points={points} fill="none" stroke="#e4e4e7" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx={x(cursor)} cy={y(prices[cursor]!)} r="2.5" fill="#e4e4e7" />

      {frame.marker ? (
        <g>
          <circle
            cx={x(frame.marker.index)}
            cy={y(prices[frame.marker.index]!)}
            r="5"
            fill="none"
            stroke={TONE_COLOR[frame.marker.tone]}
            strokeWidth="1.5"
          />
          <text
            x={Math.min(W - PAD_X, x(frame.marker.index) + 8)}
            y={y(prices[frame.marker.index]!) - 6}
            fill={TONE_COLOR[frame.marker.tone]}
            fontSize="9"
            textAnchor={x(frame.marker.index) > W * 0.7 ? "end" : "start"}
          >
            {frame.marker.label}
          </text>
        </g>
      ) : null}

      {volumes.slice(0, cursor + 1).map((volume, i) => {
        const h = (volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP);
        return (
          <rect
            key={i}
            x={x(i) - barWidth / 2}
            y={VOLUME_BOTTOM - h}
            width={barWidth}
            height={h}
            fill={i === frame.spikeIndex ? "#f59e0b" : "#52525b"}
          />
        );
      })}
      <text x={PAD_X} y={VOLUME_BOTTOM + 8} fill="#71717a" fontSize="7">
        Volume
      </text>

      {frame.rsi ? <RsiStrip rsi={frame.rsi} /> : null}
    </svg>
  );
}

function RsiStrip({ rsi }: { rsi: NonNullable<ChartFrame["rsi"]> }) {
  const left = 64;
  const right = W - PAD_X;
  const rx = (value: number) => left + (Math.min(100, Math.max(0, value)) / 100) * (right - left);
  const passes = rsi.value <= rsi.activeCap;
  const color = passes ? "#34d399" : "#f87171";

  return (
    <g>
      <text x={PAD_X} y={RSI_Y + 3} fill={color} fontSize="9" fontWeight="600">
        RSI {rsi.value}
      </text>
      <rect x={left} y={RSI_Y - 3} width={right - left} height="6" rx="3" fill="#27272a" />
      <rect
        x={rx(rsi.activeCap)}
        y={RSI_Y - 3}
        width={right - rx(rsi.activeCap)}
        height="6"
        rx="3"
        fill="#7f1d1d"
        opacity="0.7"
      />
      <line x1={rx(rsi.normalCap)} x2={rx(rsi.normalCap)} y1={RSI_Y - 7} y2={RSI_Y + 7} stroke="#d4d4d8" strokeWidth="1.2" />
      <text x={rx(rsi.normalCap)} y={RSI_Y + 16} fill="#a1a1aa" fontSize="7.5" textAnchor="end">
        Max RSI {rsi.normalCap}
      </text>
      {rsi.breakoutCap != null ? (
        <>
          <line x1={rx(rsi.breakoutCap)} x2={rx(rsi.breakoutCap)} y1={RSI_Y - 7} y2={RSI_Y + 7} stroke="#fbbf24" strokeWidth="1.2" />
          <text x={rx(rsi.breakoutCap)} y={RSI_Y - 10} fill="#fcd34d" fontSize="7.5" textAnchor="middle">
            Breakout cap {rsi.breakoutCap}
          </text>
        </>
      ) : null}
      <circle cx={rx(rsi.value)} cy={RSI_Y} r="4" fill={color} stroke="#09090b" strokeWidth="1" />
    </g>
  );
}
