"use client";

import { AnimatePresence, motion } from "framer-motion";

const ROWS: { kbd: string; does: string }[] = [
  { kbd: "⌘ K  /", does: "command palette — jump to a token" },
  { kbd: "?", does: "this cheat sheet" },
  { kbd: "esc", does: "close inspector / palette / this" },
  { kbd: "A", does: "AUTO — desk fills its own tickets" },
  { kbd: "M", does: "MANUAL — every entry waits for you" },
  { kbd: "R", does: "open risk parameters" },
  { kbd: "S", does: "arm / mute desk sounds" },
  { kbd: "F", does: "fullscreen" },
  { kbd: "click", does: "a name, a ticker print, a position — inspect it" },
];

export function ShortcutHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[70]"
            style={{ background: "rgba(5,6,10,0.62)", backdropFilter: "blur(6px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed left-1/2 top-[18vh] z-[71] w-[min(420px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-xl border"
            style={{
              background: "var(--surface-1)",
              borderColor: "var(--grid-line)",
              boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
            }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            <header className="panel-header">
              <h2 className="panel-title">operator keys</h2>
              <button type="button" onClick={onClose} className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                ✕
              </button>
            </header>
            <ul className="flex flex-col px-3 py-2">
              {ROWS.map((row) => (
                <li key={row.kbd} className="flex items-baseline gap-3 border-b py-1.5 last:border-b-0" style={{ borderColor: "var(--grid-line)" }}>
                  <kbd className="kbd shrink-0">{row.kbd}</kbd>
                  <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                    {row.does}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
