import {
  Children,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { XMarkIcon } from "@heroicons/react/20/solid";

type ToastKind = "error" | "info" | "success";

interface ToastEntry {
  id: string;
  kind: ToastKind;
  message: string;
  createdAt: number;
  duration: number;
}

interface ToastOptions {
  id?: string;
  duration?: number;
}

interface ToastApi {
  error: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
  success: (message: string, opts?: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION: Record<ToastKind, number> = {
  error: 6000,
  info: 3500,
  success: 3000,
};

// Dedupe identical messages fired within this window. Prevents spam from
// looping refresher failures or repeated unhandled rejections.
const DEDUPE_WINDOW_MS = 3000;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

// Module-level escape hatch so non-React code (window listeners, error
// boundary) can surface toasts without threading the context through.
let externalApi: ToastApi | null = null;
export function toast(): ToastApi {
  if (!externalApi) {
    return {
      error: (m) => console.error("[toast pre-init]", m),
      info: (m) => console.info("[toast pre-init]", m),
      success: (m) => console.log("[toast pre-init]", m),
      dismiss: () => {},
    };
  }
  return externalApi;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const recentRef = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, opts?: ToastOptions) => {
      const dedupeKey = `${kind}:${message}`;
      const now = Date.now();
      const last = recentRef.current.get(dedupeKey);
      if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
      recentRef.current.set(dedupeKey, now);

      const id = opts?.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`;
      const duration = opts?.duration ?? DEFAULT_DURATION[kind];
      const entry: ToastEntry = {
        id,
        kind,
        message,
        createdAt: now,
        duration,
      };
      setToasts((prev) => {
        const without = prev.filter((t) => t.id !== id);
        return [...without, entry];
      });
    },
    [],
  );

  const api = useMemo<ToastApi>(
    () => ({
      error: (m, o) => push("error", m, o),
      info: (m, o) => push("info", m, o),
      success: (m, o) => push("success", m, o),
      dismiss,
    }),
    [push, dismiss],
  );

  useEffect(() => {
    externalApi = api;
    return () => {
      if (externalApi === api) externalApi = null;
    };
  }, [api]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastHost toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: ToastEntry[];
  onDismiss: (id: string) => void;
}) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      aria-live="polite"
      className="fixed top-[40px] right-4 z-[1000] flex flex-col gap-2 pointer-events-none max-w-[420px]"
    >
      {Children.toArray(
        toasts.map((t) => (
          <ToastItem key={t.id} entry={t} onDismiss={onDismiss} />
        )),
      )}
    </div>,
    document.body,
  );
}

function ToastItem({
  entry,
  onDismiss,
}: {
  entry: ToastEntry;
  onDismiss: (id: string) => void;
}) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(entry.duration);
  const startedAtRef = useRef(Date.now());

  useEffect(() => {
    if (paused) return;
    startedAtRef.current = Date.now();
    const timer = window.setTimeout(() => {
      onDismiss(entry.id);
    }, remainingRef.current);
    return () => {
      window.clearTimeout(timer);
      remainingRef.current = Math.max(
        0,
        remainingRef.current - (Date.now() - startedAtRef.current),
      );
    };
  }, [paused, entry.id, onDismiss]);

  const palette =
    entry.kind === "error"
      ? "border-line-danger bg-bg-card text-fg"
      : entry.kind === "success"
        ? "border-green bg-bg-card text-fg"
        : "border-line bg-bg-card text-fg";

  const accent =
    entry.kind === "error"
      ? "text-red"
      : entry.kind === "success"
        ? "text-green"
        : "text-fg-muted";

  return (
    <div
      role={entry.kind === "error" ? "alert" : "status"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto flex items-start gap-3 rounded-md border px-3 py-2 shadow-lg ${palette}`}
    >
      <div
        className={`text-xs font-semibold uppercase tracking-wider ${accent} pt-[2px]`}
      >
        {entry.kind}
      </div>
      <div className="flex-1 text-sm whitespace-pre-wrap break-words">
        {entry.message}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(entry.id)}
        className="text-fg-muted hover:text-fg shrink-0"
        aria-label="Dismiss"
      >
        <XMarkIcon className="w-4 h-4" />
      </button>
    </div>
  );
}
