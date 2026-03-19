"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckCircle, AlertTriangle, Info, Flame } from "lucide-react";
import Link from "next/link";

const EMBER = [
  "#ff4800",
  "#ff5400",
  "#ff6000",
  "#ff6d00",
  "#ff7900",
  "#ff8500",
  "#ff9100",
  "#ff9e00",
  "#ffaa00",
  "#ffb600",
] as const;

const gradientCSS = `linear-gradient(180deg, ${EMBER[0]}, ${EMBER[4]}, ${EMBER[9]})`;

interface Toast {
  id: number;
  title: string;
  message: string;
  type: "success" | "warning" | "info" | "ember";
}

const TOAST_CONFIG = {
  success: { icon: CheckCircle, color: EMBER[6] },
  warning: { icon: AlertTriangle, color: EMBER[2] },
  info: { icon: Info, color: EMBER[8] },
  ember: { icon: Flame, color: EMBER[0] },
};

const SAMPLE_TOASTS: Omit<Toast, "id">[] = [
  { title: "Upload Complete", message: "24 photos have been processed successfully.", type: "success" },
  { title: "Storage Warning", message: "You're using 90% of your storage quota.", type: "warning" },
  { title: "New Collection", message: "Your 'Sunset Series' collection is ready.", type: "info" },
  { title: "Ember Mode Active", message: "All accents now use the ember palette.", type: "ember" },
  { title: "Export Ready", message: "Your gallery export is ready for download.", type: "success" },
  { title: "Processing", message: "AI is generating thumbnails for your batch.", type: "info" },
];

export default function EmberToastNotifications() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [counter, setCounter] = useState(0);

  const addToast = useCallback(() => {
    const sample = SAMPLE_TOASTS[counter % SAMPLE_TOASTS.length];
    const id = Date.now();
    setToasts((prev) => [...prev, { ...sample, id }]);
    setCounter((c) => c + 1);

    // Auto-dismiss after 5s
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, [counter]);

  const dismiss = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const clearAll = () => setToasts([]);

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-6"
      style={{ background: "#0a0a0a", fontFamily: "var(--font-geist-sans)" }}
    >
      <div className="text-center">
        <p className="mb-2 text-sm font-mono uppercase tracking-widest" style={{ color: EMBER[4] }}>
          Route /9
        </p>
        <h1
          className="text-4xl font-bold"
          style={{ fontFamily: "var(--font-display)", color: "#f0e8e0" }}
        >
          Ember Toast Notifications
        </h1>
        <p className="mt-3 text-sm" style={{ color: "#f0e8e080" }}>
          Click the button to fire toasts. They auto-dismiss after 5 seconds.
        </p>

        <div className="mt-6 flex items-center justify-center gap-3">
          <motion.button
            onClick={addToast}
            className="rounded-xl px-6 py-3 text-sm font-semibold text-black"
            style={{ background: `linear-gradient(135deg, ${EMBER[0]}, ${EMBER[4]})` }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            Fire Toast
          </motion.button>
          {toasts.length > 0 && (
            <motion.button
              onClick={clearAll}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-xl border px-4 py-3 text-sm"
              style={{ borderColor: "#ffffff15", color: "#f0e8e060" }}
            >
              Clear All
            </motion.button>
          )}
        </div>
      </div>

      {/* Toast container */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3" style={{ width: 380 }}>
        <AnimatePresence mode="popLayout">
          {toasts.map((toast, i) => {
            const config = TOAST_CONFIG[toast.type];
            const Icon = config.icon;
            return (
              <motion.div
                key={toast.id}
                layout
                initial={{ opacity: 0, x: 100, scale: 0.9 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: 100, scale: 0.9 }}
                transition={{
                  type: "spring",
                  stiffness: 400,
                  damping: 25,
                  delay: 0,
                }}
                className="relative flex overflow-hidden rounded-xl border"
                style={{
                  borderColor: "#ffffff10",
                  background: "#1a1a1a",
                }}
              >
                {/* Left accent bar */}
                <div
                  className="w-1 flex-shrink-0"
                  style={{ background: gradientCSS }}
                />

                <div className="flex flex-1 items-start gap-3 px-4 py-3.5">
                  <div
                    className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full"
                    style={{ background: config.color + "20" }}
                  >
                    <Icon size={14} style={{ color: config.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: "#f0e8e0" }}>
                      {toast.title}
                    </p>
                    <p className="mt-0.5 text-xs" style={{ color: "#f0e8e060" }}>
                      {toast.message}
                    </p>
                  </div>
                  <button
                    onClick={() => dismiss(toast.id)}
                    className="mt-0.5 flex-shrink-0 rounded p-0.5 transition-colors hover:bg-white/10"
                  >
                    <X size={14} style={{ color: "#f0e8e040" }} />
                  </button>
                </div>

                {/* Auto-dismiss progress bar */}
                <motion.div
                  className="absolute bottom-0 left-0 h-[2px]"
                  style={{ background: config.color + "60" }}
                  initial={{ width: "100%" }}
                  animate={{ width: "0%" }}
                  transition={{ duration: 5, ease: "linear" }}
                />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <nav className="mt-20 flex items-center gap-6 text-sm" style={{ color: "#f0e8e060" }}>
        <Link href="/8" className="hover:underline" style={{ color: "#f0e8e090" }}>
          ← Prev
        </Link>
        <Link href="/" className="hover:underline" style={{ color: EMBER[4] }}>
          Index
        </Link>
        <Link href="/10" className="hover:underline" style={{ color: "#f0e8e090" }}>
          Next →
        </Link>
      </nav>
    </div>
  );
}
