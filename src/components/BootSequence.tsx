"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { LogoMark } from "./LogoMark";

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
      const id = setTimeout(onDone, 520);
      return () => clearTimeout(id);
    }
    const id = setTimeout(() => setVisible((v) => v + 1), 240);
    return () => clearTimeout(id);
  }, [visible, onDone]);

  const progress = Math.min(100, (visible / LINES.length) * 100);

  return (
    <motion.div
      className="fixed inset-0 z-[60] flex items-center justify-center px-6"
      style={{ background: "rgba(10, 11, 16, 0.88)", backdropFilter: "blur(10px)" }}
      exit={{ opacity: 0, filter: "blur(8px)" }}
      transition={{ duration: 0.5 }}
    >
      <div className="scanline" />
      <div className="w-full max-w-[560px]">
        <motion.div
          className="mb-6 flex items-center gap-3"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <LogoMark size={36} />
          <div>
            <div
              className="glitch-title text-[22px] font-bold tracking-[0.28em]"
              style={{ color: "var(--series-1-glow)", textShadow: "0 0 22px rgba(34,211,238,0.55)" }}
            >
              MEMEDESK
            </div>
            <div className="text-[9px] uppercase tracking-[0.22em]" style={{ color: "var(--text-muted)" }}>
              autonomous agent terminal
            </div>
          </div>
        </motion.div>

        <div className="boot-bar mb-5">
          <span style={{ width: `${progress}%` }} />
        </div>

        <AnimatePresence>
          {LINES.slice(0, visible).map((line, i) => (
            <motion.div
              key={line}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-[12px] leading-6"
              style={{ color: i === LINES.length - 1 ? "var(--pos-glow)" : i === 0 ? "var(--series-1-glow)" : "var(--text-secondary)" }}
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
