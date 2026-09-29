import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-zinc-800/80 bg-zinc-950/20 p-4 sm:p-5",
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

export function FieldDescription({
  children,
  title,
}: {
  children: string;
  title?: string;
}) {
  return (
    <p className="text-xs leading-relaxed text-zinc-600" title={title}>
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
};

export function SettingsField({
  id,
  label,
  description,
  descriptionTitle,
  children,
  className,
  fullWidth = false,
}: SettingsFieldProps) {
  return (
    <div
      className={cn(
        "space-y-2",
        fullWidth && "sm:col-span-2",
        className,
      )}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <Label htmlFor={id} className="shrink-0 pt-2 sm:max-w-[55%]">
          {label}
        </Label>
        <div className="w-full sm:max-w-[11rem] sm:shrink-0">{children}</div>
      </div>
      <FieldDescription title={descriptionTitle ?? description}>
        {description}
      </FieldDescription>
    </div>
  );
}

export function SettingsCollapsible({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="group rounded-lg border border-zinc-800/60 bg-zinc-950/30"
      open={defaultOpen}
    >
      <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-zinc-300 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          <span className="text-zinc-500 transition group-open:rotate-90">▸</span>
          {summary}
        </span>
      </summary>
      <div className="border-t border-zinc-800/60 px-3 pb-3 pt-2">{children}</div>
    </details>
  );
}
