import {
  SettingsFieldExample,
  SettingsFieldHelp,
} from "@/components/settings-field-help";
import { Label } from "@/components/ui/label";
import type { SettingDescriptionKey } from "@/lib/settings-form-descriptions";
import { settingFieldExample } from "@/lib/settings-field-meta";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
}: {
  id?: string;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "scroll-mt-6 rounded-xl border border-zinc-800/80 bg-zinc-950/20 p-4 sm:p-5",
        className,
      )}
    >
      <div className="border-b border-zinc-800/60 pb-3">
        <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-zinc-500">{description}</p>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsFieldGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-4 sm:grid-cols-2", className)}>{children}</div>
  );
}

/** Group fields inside a SettingsSection with a visible sub-heading. */
export function SettingsSubsection({
  title,
  description,
  children,
  first = false,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  first?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-3",
        !first && "border-t border-zinc-800/60 pt-5",
        className,
      )}
    >
      <div>
        <h4 className="text-sm font-medium text-zinc-300">{title}</h4>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-zinc-600">{description}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export function FieldDescription({
  children,
  title,
  id,
}: {
  children: ReactNode;
  title?: string;
  id?: string;
}) {
  return (
    <p id={id} className="text-xs leading-relaxed text-zinc-600" title={title}>
      {children}
    </p>
  );
}

type SettingsFieldProps = {
  id: string;
  label: string;
  description: string;
  descriptionTitle?: string;
  children: ReactNode;
  className?: string;
  fullWidth?: boolean;
  /** Inline example + Learn more when defined in settings-field-meta. */
  fieldKey?: SettingDescriptionKey;
};

export function SettingsField({
  id,
  label,
  description,
  descriptionTitle,
  children,
  className,
  fullWidth = false,
  fieldKey,
}: SettingsFieldProps) {
  const describedBy = `${id}-desc`;

  return (
    <div
      className={cn(
        "space-y-2",
        fullWidth && "sm:col-span-2",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="shrink-0 space-y-1 sm:max-w-[55%]">
          <Label htmlFor={id}>{label}</Label>
          <FieldDescription id={describedBy} title={descriptionTitle ?? description}>
            {description}
          </FieldDescription>
          {fieldKey && settingFieldExample(fieldKey) ? (
            <SettingsFieldExample fieldKey={fieldKey} />
          ) : null}
        </div>
        <div className="w-full sm:max-w-[11rem] sm:shrink-0 sm:pt-0">{children}</div>
      </div>
      {fieldKey ? <SettingsFieldHelp fieldKey={fieldKey} /> : null}
    </div>
  );
}

export function SettingsCollapsible({
  summary,
  detail,
  children,
  defaultOpen = false,
}: {
  summary: string;
  /** Shown after the title when collapsed (e.g. current on/off state). */
  detail?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group rounded-lg border border-zinc-800/60 bg-zinc-950/30"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-300">
            <span className="text-zinc-500 transition group-open:rotate-90">▸</span>
            {summary}
          </span>
          {detail ? (
            <span className="text-xs font-normal text-zinc-500">{detail}</span>
          ) : null}
        </span>
      </summary>
      <div className="border-t border-zinc-800/60 px-3 pb-3 pt-2">{children}</div>
    </details>
  );
}
