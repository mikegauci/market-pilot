"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type HTMLAttributes,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type AlertDialogIds = {
  titleId: string;
  descriptionId: string;
};

const AlertDialogIdsContext = createContext<AlertDialogIds | null>(null);

type AlertDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** When false, Escape and backdrop clicks do not close the dialog. */
  dismissible?: boolean;
};

export function AlertDialog({
  open,
  onOpenChange,
  children,
  dismissible = true,
}: AlertDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const panel = panelRef.current;
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];

    const initial = focusables();
    (initial[0] ?? panel)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (dismissible) {
          event.preventDefault();
          onOpenChange(false);
        }
        return;
      }

      if (event.key !== "Tab" || !panel) return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previouslyFocused.current?.focus?.();
    };
  }, [open, onOpenChange, dismissible]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 disabled:cursor-default"
        aria-label="Close dialog"
        disabled={!dismissible}
        onClick={() => {
          if (dismissible) onOpenChange(false);
        }}
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="relative z-10 w-full max-w-md rounded-lg border border-zinc-800 bg-zinc-900 p-6 shadow-xl outline-none"
      >
        <AlertDialogIdsContext.Provider value={{ titleId, descriptionId }}>
          {children}
        </AlertDialogIdsContext.Provider>
      </div>
    </div>
  );
}

export function AlertDialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-2", className)} {...props} />;
}

export function AlertDialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const ids = useContext(AlertDialogIdsContext);
  return (
    <h2
      id={ids?.titleId}
      className={cn("text-lg font-semibold text-zinc-100", className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  const ids = useContext(AlertDialogIdsContext);
  return (
    <p
      id={ids?.descriptionId}
      className={cn("text-sm text-zinc-400", className)}
      {...props}
    />
  );
}

export function AlertDialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-6 flex justify-end gap-2", className)} {...props} />;
}

export function AlertDialogCancel({
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      type="button"
      className={cn("bg-zinc-800 hover:bg-zinc-700", className)}
      onClick={onClick}
      {...props}
    />
  );
}

export function AlertDialogAction({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <Button type="button" className={className} {...props} />;
}
