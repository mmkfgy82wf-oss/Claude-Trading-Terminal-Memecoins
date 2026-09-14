"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { CHAINS } from "@/lib/market/chains";
import type { ConsensusView, Token } from "@/lib/types";
import { formatPct } from "@/lib/util/format";
import { TokenChip } from "./ui";

interface Command {
  id: string;
  label: string;
  hint: string;
  kbd?: string;
  run: () => void;
}

/**
 * ⌘K / Ctrl+K. Jump to a name on the board or fire an operator command
 * without taking the hands off the keyboard.
 */
export function CommandPalette({
  open,
  tokens,
  consensus,
  onClose,
  onInspect,
  commands,
}: {
  open: boolean;
  tokens: Token[];
  consensus: ConsensusView[];
  onClose: () => void;
  onInspect: (tokenId: string) => void;
  commands: Command[];
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const tokenHits = useMemo(() => {
    if (!q) return tokens.slice(0, 6);
    return tokens
      .filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [q, tokens]);

  const commandHits = useMemo(() => {
    if (!q) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q));
  }, [q, commands]);

  const rows: { id: string; run: () => void }[] = [
    ...tokenHits.map((t) => ({ id: `tok-${t.id}`, run: () => onInspect(t.id) })),
    ...commandHits.map((c) => ({ id: c.id, run: c.run })),
  ];

  useEffect(() => {
    setActive(0);
  }, [query]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => Math.min(rows.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      rows[active]?.run();
    }
  };

  const byId = new Map(consensus.map((c) => [c.tokenId, c]));

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
            className="palette-sheet fixed inset-x-0 top-[14vh] z-[71] mx-auto w-[min(560px,calc(100%-24px))] overflow-hidden rounded-xl border"
            style={{
              background: "color-mix(in srgb, var(--surface-1) 94%, transparent)",
              borderColor: "color-mix(in srgb, var(--series-1) 35%, var(--grid-line))",
              boxShadow: "0 30px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(34,211,238,0.12)",
            }}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          >
            <div className="flex items-center gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--grid-line)" }}>
              <span style={{ color: "var(--series-1-glow)" }}>⌕</span>
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKey}
                placeholder="Jump to a token or command…"
                className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                style={{ color: "var(--text-primary)" }}
              />
              <kbd className="kbd">esc</kbd>
            </div>

            <div className="max-h-[52vh] overflow-y-auto py-1">
              {tokenHits.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                    board
                  </div>
                  {tokenHits.map((token, i) => {
                    const view = byId.get(token.id);
                    const selected = active === i;
                    return (
                      <button
                        key={token.id}
                        type="button"
                        onMouseEnter={() => setActive(i)}
                        onClick={() => onInspect(token.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
                        style={{ background: selected ? "rgba(34,211,238,0.1)" : "transparent" }}
                      >
                        <TokenChip symbol={token.symbol} size={16} />
                        <span className="w-20 truncate text-[12px] font-bold">{token.symbol}</span>
                        <span className="text-[9px] uppercase" style={{ color: "var(--text-muted)" }}>
                          {CHAINS[token.chain].tag}
                        </span>
                        <span
                          className="tabular ml-auto text-[11px]"
                          style={{ color: token.change1h >= 0 ? "var(--pos-glow)" : "var(--neg-glow)" }}
                        >
                          {formatPct(token.change1h, 0)}
                        </span>
                        {view && (
                          <span className="text-[9px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                            {view.verdict.replace("-", " ")}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {commandHits.length > 0 && (
                <div>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--text-muted)" }}>
                    commands
                  </div>
                  {commandHits.map((command, i) => {
                    const index = tokenHits.length + i;
                    const selected = active === index;
                    return (
                      <button
                        key={command.id}
                        type="button"
                        onMouseEnter={() => setActive(index)}
                        onClick={command.run}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left"
                        style={{ background: selected ? "rgba(34,211,238,0.1)" : "transparent" }}
                      >
                        <span className="text-[12px]">{command.label}</span>
                        <span className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {command.hint}
                        </span>
                        {command.kbd && <kbd className="kbd ml-auto">{command.kbd}</kbd>}
                      </button>
                    );
                  })}
                </div>
              )}

              {tokenHits.length === 0 && commandHits.length === 0 && (
                <div className="px-3 py-6 text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
                  Nothing matches.
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
