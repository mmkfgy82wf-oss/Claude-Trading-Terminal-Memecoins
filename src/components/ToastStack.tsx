"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { DeskToast } from "./useDeskChrome";

export function ToastStack({
  toasts,
  burst,
  onDismiss,
}: {
  toasts: DeskToast[];
  burst: "win" | "loss" | null;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="pointer-events-none fixed top-16 right-3 z-[80] flex w-[min(300px,calc(100%-24px))] flex-col gap-2 sm:top-auto sm:bottom-10 sm:left-3 sm:right-auto sm:flex-col-reverse">
      <AnimatePresence>
        {burst && (
          <motion.div
            key={burst}
            className="burst"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.9 }}
            aria-hidden
          >
            {Array.from({ length: 16 }, (_, i) => (
              <i key={i} style={{ ["--i" as string]: i, ["--tone" as string]: burst === "win" ? "var(--pos-glow)" : "var(--neg-glow)" }} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.button
            key={toast.id}
            type="button"
            layout
            initial={{ opacity: 0, x: 24, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 16 }}
            onClick={() => onDismiss(toast.id)}
            className="pointer-events-auto toast-card w-full rounded-lg border px-3 py-2 text-left"
            style={{
              background: "color-mix(in srgb, var(--surface-1) 92%, transparent)",
              borderColor:
                toast.tone === "pos"
                  ? "rgba(3,175,88,0.45)"
                  : toast.tone === "neg"
                    ? "rgba(229,72,77,0.45)"
                    : "rgba(7,164,186,0.4)",
              boxShadow:
                toast.tone === "pos"
                  ? "0 8px 28px rgba(3,175,88,0.18)"
                  : toast.tone === "neg"
                    ? "0 8px 28px rgba(229,72,77,0.16)"
                    : "0 8px 28px rgba(7,164,186,0.16)",
            }}
          >
            <div
              className="text-[11px] font-bold tracking-wider"
              style={{
                color: toast.tone === "pos" ? "var(--pos-glow)" : toast.tone === "neg" ? "var(--neg-glow)" : "var(--series-1-glow)",
              }}
            >
              {toast.title}
            </div>
            <div className="mt-0.5 truncate text-[10px]" style={{ color: "var(--text-secondary)" }}>
              {toast.body}
            </div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
