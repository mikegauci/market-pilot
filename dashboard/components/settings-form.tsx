"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSettings } from "@/lib/actions";
import type { Settings } from "@/lib/types/database";

export function SettingsForm({ settings }: { settings: Settings }) {
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardTitle>Risk & Strategy Settings</CardTitle>
      <p className="mt-1 text-xs text-zinc-500">
        Bot ON/OFF and simulated vs IBKR orders are on the{" "}
        <span className="text-zinc-300">Overview</span> page. Trading mode:{" "}
        <span className="text-zinc-300">{settings.trading_mode}</span> (live requires server{" "}
        <code className="text-zinc-400">.env</code> change).
      </p>
      <form
        className="mt-6 grid gap-4 sm:grid-cols-2"
        action={(formData) => {
          startTransition(async () => {
            await updateSettings(formData);
          });
        }}
      >
        <div>
          <Label htmlFor="minimum_jev_confidence">Min Jev confidence</Label>
          <Input
            id="minimum_jev_confidence"
            name="minimum_jev_confidence"
            type="number"
            step="0.01"
            defaultValue={settings.minimum_jev_confidence}
            required
          />
        </div>
        <div>
          <Label htmlFor="signal_record_threshold">Signal record threshold</Label>
          <Input
            id="signal_record_threshold"
            name="signal_record_threshold"
            type="number"
            step="0.01"
            defaultValue={settings.signal_record_threshold}
            required
          />
        </div>
        <div>
          <Label htmlFor="risk_per_trade">Risk per trade ($)</Label>
          <Input
            id="risk_per_trade"
            name="risk_per_trade"
            type="number"
            step="0.01"
            defaultValue={settings.risk_per_trade}
            required
          />
        </div>
        <div>
          <Label htmlFor="max_position_size">Max position size ($)</Label>
          <Input
            id="max_position_size"
            name="max_position_size"
            type="number"
            step="0.01"
            defaultValue={settings.max_position_size}
            required
          />
        </div>
        <div>
          <Label htmlFor="max_daily_loss">Max daily loss ($)</Label>
          <Input
            id="max_daily_loss"
            name="max_daily_loss"
            type="number"
            step="0.01"
            defaultValue={settings.max_daily_loss}
            required
          />
        </div>
        <div>
          <Label htmlFor="max_open_positions">Max open positions</Label>
          <Input
            id="max_open_positions"
            name="max_open_positions"
            type="number"
            step="1"
            defaultValue={settings.max_open_positions}
            required
          />
        </div>
        <div>
          <Label htmlFor="stop_loss_percentage">Stop loss %</Label>
          <Input
            id="stop_loss_percentage"
            name="stop_loss_percentage"
            type="number"
            step="0.001"
            defaultValue={settings.stop_loss_percentage}
            required
          />
        </div>
        <div>
          <Label htmlFor="take_profit_percentage">Take profit %</Label>
          <Input
            id="take_profit_percentage"
            name="take_profit_percentage"
            type="number"
            step="0.001"
            defaultValue={settings.take_profit_percentage}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="watchlist">Watchlist (comma-separated)</Label>
          <Input
            id="watchlist"
            name="watchlist"
            defaultValue={settings.watchlist.join(", ")}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>
    </Card>
  );
}
