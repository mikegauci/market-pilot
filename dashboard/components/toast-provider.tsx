"use client";

import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "watchlist" | "trade-open" | "trade-closed";

export type ToastRecord = {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
};

type ToastInput = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

type ToastContextValue = {
  push: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 6_000;
const MAX_TOASTS = 5;

function toastVariantClass(variant: ToastVariant): string {
  switch (variant) {
    case "watchlist":
      return "border-sky-500/40 bg-sky-950/90";
    case "trade-open":
      return "border-emerald-500/40 bg-emerald-950/90";
    case "trade-closed":
      return "border-zinc-600 bg-zinc-900/95";
    default:
      return "border-zinc-700 bg-zinc-900/95";
  }
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const record: ToastRecord = {
        id,
        title: input.title,
        description: input.description,
        variant: input.variant ?? "default",
      };
      setToasts((current) => [record, ...current].slice(0, MAX_TOASTS));
      const durationMs = input.durationMs ?? DEFAULT_DURATION_MS;
      timersRef.current.set(
        id,
        setTimeout(() => dismiss(id), durationMs),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(100vw-2rem,22rem)] flex-col gap-2 sm:bottom-6 sm:right-6"
        aria-live="polite"
        aria-relevant="additions"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "pointer-events-auto rounded-lg border px-3 py-2.5 shadow-lg shadow-black/40",
              toastVariantClass(toast.variant),
            )}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-zinc-50">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-0.5 text-xs text-zinc-400">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                aria-label="Dismiss notification"
                onClick={() => dismiss(toast.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return ctx;
}
