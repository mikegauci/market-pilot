import Link from "next/link";
import {
  SETTING_STRATEGY_ANCHORS,
  settingFieldExample,
  strategyHelpHref,
} from "@/lib/settings-field-meta";
import {
  SETTING_DESCRIPTIONS_FULL,
  type SettingDescriptionKey,
} from "@/lib/settings-form-descriptions";

export function SettingsFieldExample({ fieldKey }: { fieldKey: SettingDescriptionKey }) {
  const example = settingFieldExample(fieldKey);
  if (!example) return null;

  return (
    <p className="text-xs leading-relaxed text-zinc-500">
      <span className="font-medium text-zinc-600">Example: </span>
      {example}
    </p>
  );
}

export function SettingsFieldHelp({ fieldKey }: { fieldKey: SettingDescriptionKey }) {
  const full = SETTING_DESCRIPTIONS_FULL[fieldKey] ?? null;
  const anchor = SETTING_STRATEGY_ANCHORS[fieldKey];

  if (!full && !anchor) return null;

  return (
    <details className="group mt-1 text-xs">
      <summary className="cursor-pointer list-none text-emerald-500/80 marker:content-none hover:text-emerald-400 [&::-webkit-details-marker]:hidden">
        Learn more
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-2 text-zinc-400">
        {full ? <p className="leading-relaxed">{full}</p> : null}
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
    </details>
  );
}
