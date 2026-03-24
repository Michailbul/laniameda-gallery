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

/* ── Icon colors per type ── */

function iconColor(type: ToastType) {
  switch (type) {
    case "success":
      return "var(--v7-coral, #e8715a)";
    case "warning":
      return "#d97706";
    case "info":
      return "#6366f1";
    default:
      return "var(--text-secondary)";
  }
}

function ToastIcon({ type }: { type: ToastType }) {
  const color = iconColor(type);
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

      {/* Toast stack — bottom-center */}
      <div
        className="pointer-events-none fixed bottom-20 left-0 right-0 z-[100] flex flex-col items-center gap-2"
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
                className="flex items-center gap-2.5 rounded-full px-4 py-2.5"
                style={{
                  backgroundColor: "var(--v7-ink, #201710)",
                  color: "var(--v7-paper, #f5efe8)",
                  boxShadow:
                    "0 8px 32px rgba(0, 0, 0, 0.24), 0 2px 8px rgba(0, 0, 0, 0.12)",
                }}
              >
                {/* Icon with ring */}
                <div
                  className="relative flex items-center justify-center shrink-0"
                  style={{ width: 22, height: 22 }}
                >
                  {/* Progress ring */}
                  {t.duration > 0 && (
                    <svg
                      className="absolute inset-0"
                      viewBox="0 0 22 22"
                      style={{ transform: "rotate(-90deg)" }}
                    >
                      <circle
                        cx="11"
                        cy="11"
                        r="9.5"
                        fill="none"
                        stroke="rgba(255,255,255,0.12)"
                        strokeWidth="1.5"
                      />
                      <motion.circle
                        cx="11"
                        cy="11"
                        r="9.5"
                        fill="none"
                        stroke={iconColor(t.type)}
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 9.5}
                        initial={{ strokeDashoffset: 0 }}
                        animate={{ strokeDashoffset: 2 * Math.PI * 9.5 }}
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
                <div className="flex items-baseline gap-2">
                  <span
                    className="text-[13px] font-semibold leading-none tracking-tight"
                    style={{ color: "var(--v7-paper, #f5efe8)" }}
                  >
                    {t.title}
                  </span>
                  {t.message && (
                    <span
                      className="text-[10px] font-bold uppercase leading-none tracking-[0.08em]"
                      style={{ color: "rgba(255,255,255,0.4)" }}
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
