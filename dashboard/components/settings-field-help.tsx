import Link from "next/link";
import {
  SETTING_FIELD_CHIPS,
  SETTING_FIELD_EXAMPLES,
  SETTING_STRATEGY_ANCHORS,
  strategyHelpHref,
  type SettingsFieldMetaKey,
} from "@/lib/settings-field-meta";
import {
  SETTING_DESCRIPTIONS_FULL,
  type SettingDescriptionKey,
} from "@/lib/settings-form-descriptions";
import { cn } from "@/lib/utils";

export function SettingsFieldChipRow({ fieldKey }: { fieldKey: SettingsFieldMetaKey }) {
  const chips = SETTING_FIELD_CHIPS[fieldKey];
  if (!chips?.length) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip.label}
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-medium",
            chip.tone === "skip"
              ? "border-red-900/50 bg-red-950/30 text-red-300/90"
              : "border-zinc-700/80 bg-zinc-900/50 text-zinc-500",
          )}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

export function SettingsFieldHelp({
  fieldKey,
}: {
  fieldKey: SettingDescriptionKey | SettingsFieldMetaKey;
}) {
  const full =
    SETTING_DESCRIPTIONS_FULL[fieldKey as SettingDescriptionKey] ?? null;
  const example =
    SETTING_FIELD_EXAMPLES[fieldKey as SettingsFieldMetaKey] ?? null;
  const anchor = SETTING_STRATEGY_ANCHORS[fieldKey as SettingDescriptionKey];

  if (!full && !example) return null;

  return (
    <details className="group mt-1 text-xs">
      <summary className="cursor-pointer list-none text-emerald-500/80 marker:content-none hover:text-emerald-400 [&::-webkit-details-marker]:hidden">
        Learn more
      </summary>
      <div className="mt-2 space-y-2 rounded-md border border-zinc-800/60 bg-zinc-950/40 px-2.5 py-2 text-zinc-400">
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
    </details>
  );
}
