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

/* ── Accent color per type ── */

function accentColor(type: ToastType) {
  switch (type) {
    case "success":
      return "var(--lm-coral, #e8715a)";
    case "warning":
      return "#d97706";
    case "info":
      return "#6366f1";
    default:
      return "var(--lm-text-secondary, #8a7e72)";
  }
}

function ToastIcon({ type }: { type: ToastType }) {
  const color = accentColor(type);
  const size = 14;
  switch (type) {
    case "success":
      return <Check style={{ color, width: size, height: size }} strokeWidth={3} />;
    case "warning":
      return <AlertTriangle style={{ color, width: size, height: size }} strokeWidth={2.5} />;
    case "info":
      return <Info style={{ color, width: size, height: size }} strokeWidth={2.5} />;
    default:
      return null;
  }
}

/* ── Provider ── */

const AUTO_DISMISS_MS = 2800;
const MAX_TOASTS = 4;

export function CoralToastProvider({
  children,
  contentLeft,
  contentRight,
}: {
  children: React.ReactNode;
  contentLeft?: string;
  contentRight?: string;
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

      {/* Toast stack — centered to content area (matches dock positioning) */}
      <div
        className="pointer-events-none fixed z-[100] flex flex-col items-center justify-center gap-2"
        style={{
          bottom: 88,
          left: contentLeft || "0",
          right: contentRight || "0",
          transition: "left 250ms ease-out, right 250ms ease-out",
        }}
        aria-live="polite"
      >
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.92, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -8, scale: 0.95, filter: "blur(4px)" }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto relative cursor-pointer"
              onClick={() => dismiss(t.id)}
            >
              <div
                className="flex items-center gap-2.5 rounded-full"
                style={{
                  padding: "8px 16px 8px 10px",
                  backgroundColor: "var(--lm-surface-1, #f5efe8)",
                  border: "1px solid var(--lm-border-default, rgba(32,23,16,0.08))",
                  boxShadow:
                    "0 4px 24px rgba(32, 23, 16, 0.10), 0 1px 4px rgba(32, 23, 16, 0.06)",
                }}
              >
                {/* Icon with progress ring */}
                <div
                  className="relative flex items-center justify-center shrink-0"
                  style={{ width: 24, height: 24 }}
                >
                  {t.duration > 0 && (
                    <svg
                      className="absolute inset-0"
                      viewBox="0 0 24 24"
                      style={{ transform: "rotate(-90deg)" }}
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10.5"
                        fill="none"
                        stroke="var(--lm-border-default, rgba(32,23,16,0.08))"
                        strokeWidth="1.5"
                      />
                      <motion.circle
                        cx="12"
                        cy="12"
                        r="10.5"
                        fill="none"
                        stroke={accentColor(t.type)}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 10.5}
                        initial={{ strokeDashoffset: 0 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 10.5 }}
                        transition={{
                          duration: t.duration / 1000,
                          ease: "linear",
                        }}
                      />
                    </svg>
                  )}
                  <ToastIcon type={t.type} />
                </div>

                {/* Text */}
                <div className="flex items-baseline gap-1.5">
                  <span
                    className="text-[13px] font-semibold leading-none"
                    style={{ color: "var(--lm-text-primary, #201710)" }}
                  >
                    {t.title}
                  </span>
                  {t.message && (
                    <span
                      className="text-[10px] font-bold uppercase leading-none tracking-[0.06em]"
                      style={{ color: "var(--lm-text-ghost, rgba(32,23,16,0.3))" }}
                    >
                      {t.message}
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </CoralToastContext.Provider>
  );
}
