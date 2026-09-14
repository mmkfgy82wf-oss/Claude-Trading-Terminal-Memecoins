"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { RiskConfig } from "@/lib/types";

interface Field {
  key: keyof RiskConfig;
  label: string;
  hint: string;
  step?: number;
}

const FIELDS: Field[] = [
  { key: "startingCapitalUsd", label: "book size ($)", hint: "split evenly across the chain treasuries; changing it resets the book", step: 100 },
  { key: "maxPositionPct", label: "max position (% book)", hint: "per-name ceiling before conviction scaling" },
  { key: "maxOpenPositions", label: "max open positions", hint: "hard slot count", step: 1 },
  { key: "maxPortfolioExposurePct", label: "max exposure (%)", hint: "total capital allowed to be at risk" },
  { key: "stopLossPct", label: "stop-loss (%)", hint: "hard exit below entry" },
  { key: "breakevenTriggerPct", label: "breakeven trigger (%)", hint: "peak gain at which the stop moves up to entry — stops a winner becoming a full loser" },
  { key: "breakevenBufferPct", label: "breakeven buffer (%)", hint: "hard floor: never let an armed position close below this" },
  { key: "earlyTrailPct", label: "early trail (%)", hint: "trail distance once armed but below the first take-profit rung" },
  { key: "liquidityDropExitPct", label: "pool drain exit (%)", hint: "exit when the pool falls this far below its deepest level while held" },
  { key: "trailingStopPct", label: "trailing stop (%)", hint: "arms after the first take-profit rung" },
  { key: "maxSlippagePct", label: "max slippage (%)", hint: "entries above this are refused", step: 0.25 },
  { key: "minLiquidityUsd", label: "min liquidity ($)", hint: "pools thinner than this are ignored", step: 1000 },
  { key: "minVolume24hUsd", label: "min 24h volume ($)", hint: "attention floor", step: 5000 },
  { key: "minConsensusScore", label: "min consensus score", hint: "agreement needed before a ticket is sized" },
  { key: "dailyLossLimitPct", label: "daily loss limit (%)", hint: "halts new entries for the day" },
];

/**
 * Runtime risk configuration. Nothing here is cosmetic — every field is read by
 * RISK or EXECUTOR on the next tick, so the desk's behaviour changes live.
 */
export function SettingsDrawer({
  open,
  risk,
  onClose,
  onApply,
  onReset,
}: {
  open: boolean;
  risk: RiskConfig;
  onClose: () => void;
  onApply: (patch: Partial<RiskConfig>) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ladder, setLadder] = useState(risk.takeProfitLadder.join(", "));

  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(FIELDS.map((f) => [f.key, String(risk[f.key])])));
    setLadder(risk.takeProfitLadder.join(", "));
  }, [open, risk]);

  const apply = () => {
    const patch: Partial<RiskConfig> = {};
    for (const field of FIELDS) {
      const value = Number(draft[field.key]);
      if (Number.isFinite(value)) patch[field.key] = value as never;
    }
    const rungs = ladder
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (rungs.length) patch.takeProfitLadder = rungs;
    onApply(patch);
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40"
            style={{ background: "rgba(5,6,10,0.65)", backdropFilter: "blur(2px)" }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.aside
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col border-l"
            style={{
              background: "var(--surface-1)",
              borderColor: "var(--grid-line)",
              boxShadow: "-18px 0 60px rgba(7,164,186,0.12), -1px 0 0 rgba(34,211,238,0.35)",
            }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 280, damping: 32 }}
          >
            <header className="panel-header shrink-0">
              <h2 className="panel-title">risk parameters</h2>
              <button type="button" onClick={onClose} className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                ✕
              </button>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
              <div className="flex flex-col gap-3">
                {FIELDS.map((field) => (
                  <label key={field.key} className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                      {field.label}
                    </span>
                    <input
                      type="number"
                      step={field.step ?? 1}
                      value={draft[field.key] ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                      className="tabular rounded border px-2 py-1.5 text-[12px] outline-none focus:brightness-125"
                      style={{ background: "var(--surface-2)", borderColor: "var(--grid-line)", color: "var(--text-primary)" }}
                    />
                    <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                      {field.hint}
                    </span>
                  </label>
                ))}

                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>
                    take-profit ladder (%)
                  </span>
                  <input
                    value={ladder}
                    onChange={(e) => setLadder(e.target.value)}
                    className="tabular rounded border px-2 py-1.5 text-[12px] outline-none focus:brightness-125"
                    style={{ background: "var(--surface-2)", borderColor: "var(--grid-line)", color: "var(--text-primary)" }}
                  />
                  <span className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                    comma separated — sells 40% / 35% / the rest at each rung
                  </span>
                </label>
              </div>
            </div>

            {/* Changing parameters mid-run muddles the result, so starting a
                clean run under the new ones is offered right here. */}
            <div className="shrink-0 border-t px-3 py-2.5" style={{ borderColor: "var(--grid-line)" }}>
              <button
                type="button"
                onClick={() => {
                  onReset();
                  onClose();
                }}
                className="w-full rounded border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-transform active:scale-[0.99]"
                style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
              >
                ↺ start a fresh run
              </button>
              <p className="mt-1 text-[9px] leading-snug" style={{ color: "var(--text-muted)" }}>
                Refunds the treasuries to the book size above and clears positions, fills and the
                equity curve. Paper only — there is nothing else it could touch.
              </p>
            </div>

            <footer className="flex shrink-0 gap-2 border-t px-3 py-3" style={{ borderColor: "var(--grid-line)" }}>
              <button
                type="button"
                onClick={apply}
                className="flex-1 rounded px-3 py-2 text-[11px] font-bold uppercase tracking-wider"
                style={{ background: "var(--series-1)", color: "var(--surface-0)" }}
              >
                apply to desk
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border px-3 py-2 text-[11px] uppercase tracking-wider"
                style={{ borderColor: "var(--grid-line)", color: "var(--text-secondary)" }}
              >
                cancel
              </button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
