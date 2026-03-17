"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, AlertTriangle, Info } from "lucide-react";

/* ── Types ── */

type ToastType = "success" | "warning" | "info" | "default";

interface ToastItem {
  id: number;
  title: string;
  message?: string;
  type: ToastType;
  duration: number;
}

interface CoralToastContextValue {
  toast: (
    title: string,
    message?: string,
    type?: ToastType,
    duration?: number,
  ) => void;
}

/* ── Context ── */

const CoralToastContext = createContext<CoralToastContextValue | null>(null);

export function useCoralToast(): CoralToastContextValue {
  const ctx = useContext(CoralToastContext);
  if (!ctx) throw new Error("useCoralToast must be used within CoralToastProvider");
  return ctx;
}

export function useCoralToastSafe(): CoralToastContextValue | null {
  return useContext(CoralToastContext);
}

/* ── Accent bar color per type ── */

function accentGradient(type: ToastType) {
  switch (type) {
    case "success":
      return "linear-gradient(180deg, var(--gradient-3), var(--gradient-5))";
    case "warning":
      return "linear-gradient(180deg, var(--gradient-1), var(--gradient-3))";
    case "info":
      return "linear-gradient(180deg, var(--gradient-5), var(--gradient-8))";
    default:
      return "linear-gradient(180deg, var(--gradient-2), var(--gradient-4))";
  }
}

function ToastIcon({ type }: { type: ToastType }) {
  const style = { color: "var(--gradient-3)", width: 16, height: 16 };
  switch (type) {
    case "success":
      return <Check style={style} />;
    case "warning":
      return <AlertTriangle style={style} />;
    case "info":
      return <Info style={style} />;
    default:
      return null;
  }
}

/* ── Provider ── */

const AUTO_DISMISS_MS = 3500;
const MAX_TOASTS = 4;

export function CoralToastProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (
      title: string,
      message?: string,
      type: ToastType = "default",
      duration: number = AUTO_DISMISS_MS,
    ) => {
      const id = ++idRef.current;
      const item: ToastItem = { id, title, message, type, duration };
      setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), item]);

      if (duration > 0) {
        setTimeout(() => dismiss(id), duration);
      }
    },
    [dismiss],
  );

  return (
    <CoralToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast stack — bottom-right */}
      <div
        className="pointer-events-none fixed bottom-6 right-6 z-[100] flex flex-col-reverse items-end gap-2"
        aria-live="polite"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto flex overflow-hidden rounded-xl"
              style={{
                backgroundColor: "var(--surface-0)",
                border: "1px solid var(--border-default)",
                boxShadow: "var(--shadow-lg)",
                minWidth: 260,
                maxWidth: 360,
              }}
              onClick={() => dismiss(t.id)}
            >
              {/* Accent bar */}
              <div
                className="w-1 shrink-0"
                style={{ background: accentGradient(t.type) }}
              />

              {/* Content */}
              <div className="flex flex-1 items-start gap-2.5 px-3.5 py-3">
                <ToastIcon type={t.type} />
                <div className="flex flex-col gap-0.5">
                  <span
                    className="text-xs font-semibold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {t.title}
                  </span>
                  {t.message && (
                    <span
                      className="text-xs"
                      style={{ color: "var(--text-tertiary)" }}
                    >
                      {t.message}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              {t.duration > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px]">
                  <motion.div
                    className="h-full"
                    style={{
                      background:
                        "linear-gradient(90deg, var(--gradient-1), var(--gradient-5))",
                    }}
                    initial={{ width: "100%" }}
                    animate={{ width: "0%" }}
                    transition={{
                      duration: t.duration / 1000,
                      ease: "linear",
                    }}
                  />
                </div>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </CoralToastContext.Provider>
  );
}
