"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

const LINES = [
  "MEMEDESK v0.1 — autonomous memecoin desk",
  "mounting market feed ............ solana · robinhood chain",
  "spawning agents ................. SCOUT SENTINEL QUANT NARRATOR RISK EXECUTOR",
  "loading risk profile ............ aggressive · 10 SOL paper capital",
  "execution mode .................. PAPER (live wallet seam idle)",
  "desk online.",
];

/** A short cold-start sequence. Skipped entirely under reduced-motion. */
export function BootSequence({ onDone }: { onDone: () => void }) {
  const [visible, setVisible] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      onDone();
      return;
    }
    if (visible >= LINES.length) {
      const id = setTimeout(onDone, 450);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setVisible((v) => v + 1), 230);
    return () => clearTimeout(id);
  }, [visible, onDone]);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "var(--surface-0)" }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="w-full max-w-[560px]">
        <AnimatePresence>
          {LINES.slice(0, visible).map((line, i) => (
            <motion.div
              key={line}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-[12px] leading-6"
              style={{ color: i === 0 ? "var(--series-1-glow)" : "var(--text-secondary)" }}
            >
              {i === 0 ? "" : "▸ "}
              {line}
            </motion.div>
          ))}
        </AnimatePresence>
        <span className="blink text-[12px]" style={{ color: "var(--series-1-glow)" }}>
          █
        </span>
      </div>
    </motion.div>
  );
}
