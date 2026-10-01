"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { fetchJevCalibrationBuckets } from "@/lib/data-client";
import {
  ANALYTICS_CALIBRATION_LOOKBACK_DAYS,
} from "@/lib/analytics-data";
import {
  calibrationFocusBucketLabels,
  type CalibrationBucket,
} from "@/lib/jev-calibration";
import { perBarTooltipProps } from "@/lib/recharts-bar-interaction";
import { formatPercent } from "@/lib/utils";

function CalibrationTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { payload?: CalibrationBucket; value?: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const bucket = payload[0]?.payload;
  if (!bucket) return null;
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1 font-medium text-zinc-200">{label}</p>}
      <p className="text-zinc-300">
        Avg 15m return:{" "}
        <span className="tabular-nums text-emerald-300">
          {bucket.avgReturn15m.toFixed(3)}%
        </span>
      </p>
      <p className="text-zinc-500">
        {bucket.count.toLocaleString()} predictions · avg BUY{" "}
        {formatPercent(bucket.avgBuy)}
      </p>
    </div>
  );
}

type Props = {
  minJevConfidencePct: number;
};

/**
 * Optional analytics — not used for live trading. Loads only when expanded (one small RPC).
 */
export function JevCalibrationCard({ minJevConfidencePct }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [buckets, setBuckets] = useState<CalibrationBucket[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const focusLabels = useMemo(
    () => calibrationFocusBucketLabels(minJevConfidencePct),
    [minJevConfidencePct],
  );

  const sampleCount = useMemo(
    () => (buckets ?? []).reduce((total, bucket) => total + bucket.count, 0),
    [buckets],
  );

  const loadCalibration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchJevCalibrationBuckets(ANALYTICS_CALIBRATION_LOOKBACK_DAYS);
      setBuckets(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load calibration");
      setBuckets(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleToggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next && buckets === null && !loading) {
        void loadCalibration();
      }
      return next;
    });
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Jev calibration (15m forward return)</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Optional sanity check — does not change live trades. Uses matured predictions from
            the last {ANALYTICS_CALIBRATION_LOOKBACK_DAYS} days (aggregated in the database, not
            thousands of rows in the browser).
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={handleToggle}>
          {open ? "Hide" : "Show calibration"}
        </Button>
      </div>

      {!open ? null : loading ? (
        <p className="mt-4 text-sm text-zinc-500">Loading calibration…</p>
      ) : error ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-amber-400/90">{error}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadCalibration()}>
            Retry
          </Button>
        </div>
      ) : buckets && buckets.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          No matured 15m returns in the last {ANALYTICS_CALIBRATION_LOOKBACK_DAYS} days. The trader
          fills these when forward-return backfill is enabled, or after predictions age out.
        </p>
      ) : buckets ? (
        <>
          <p className="mt-3 text-xs text-zinc-500">
            {sampleCount > 0
              ? `Based on ${sampleCount.toLocaleString()} predictions. `
              : ""}
            With min confidence at {minJevConfidencePct}%, focus on {focusLabels} — positive
            averages suggest higher BUY scores tended to rise over 15 minutes.
          </p>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" />
                <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} unit="%" />
                <Tooltip {...perBarTooltipProps} content={<CalibrationTooltip />} />
                <Bar
                  dataKey="avgReturn15m"
                  fill="#34d399"
                  radius={[4, 4, 0, 0]}
                  activeBar={{ fill: "#6ee7b7", stroke: "#34d399", strokeWidth: 1 }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : null}
    </Card>
  );
}
