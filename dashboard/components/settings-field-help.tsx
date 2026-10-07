"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SETTING_STRATEGY_ANCHORS,
  settingFieldExample,
  strategyHelpHref,
} from "@/lib/settings-field-meta";
import {
  SETTING_DESCRIPTIONS_FULL,
  type SettingDescriptionKey,
} from "@/lib/settings-form-descriptions";

export function SettingsFieldHelp({ fieldKey }: { fieldKey: SettingDescriptionKey }) {
  const [open, setOpen] = useState(false);
  const full = SETTING_DESCRIPTIONS_FULL[fieldKey] ?? null;
  const example = settingFieldExample(fieldKey);
  const anchor = SETTING_STRATEGY_ANCHORS[fieldKey];

  if (!full && !example && !anchor) return null;

  const panelId = `${fieldKey}-learn-more`;

  return (
    <div className="mt-1 text-xs">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="text-left text-emerald-500/80 underline-offset-2 hover:text-emerald-400 hover:underline"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide details" : "Learn more"}
      </button>
      {open ? (
        <div
          id={panelId}
          className="mt-2 space-y-2 rounded-md border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-2 text-zinc-400"
        >
          {full ? <p className="leading-relaxed">{full}</p> : null}
          {example ? (
            <p className="leading-relaxed text-zinc-500">
              <span className="font-medium text-zinc-400">Example: </span>
              {example}
            </p>
          ) : null}
          {anchor ? (
            <p>
              <Link
                href={strategyHelpHref(anchor)}
                className="text-emerald-500/80 hover:text-emerald-400"
              >
                See Strategy → {anchor.replace(/-/g, " ")}
              </Link>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
