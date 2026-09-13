"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useState } from "react";
import { useTerminal } from "@/lib/useTerminal";
import { AgentConsole } from "./AgentConsole";
import { ApprovalQueue } from "./ApprovalQueue";
import { Atmosphere } from "./Atmosphere";
import { BootSequence } from "./BootSequence";
import { ChainStatusBar } from "./ChainStatusBar";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { TradeLog } from "./TradeLog";
import { PortfolioPanel } from "./PortfolioPanel";
import { PositionsPanel } from "./PositionsPanel";
import { SettingsDrawer } from "./SettingsDrawer";
import { SignalFeed } from "./SignalFeed";
import { TickerTape } from "./TickerTape";
import { TopBar } from "./TopBar";
import { WatchlistPanel } from "./WatchlistPanel";

/**
 * The terminal shell.
 *
 * Layout is a three-column desk on wide screens and a single column on a phone;
 * every panel scrolls inside its own frame so the page itself never scrolls
 * sideways.
 */
export function Terminal() {
  const { snapshot, connection, send } = useTerminal();
  const [booting, setBooting] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const finishBoot = useCallback(() => setBooting(false), []);

  return (
    <div className="relative flex min-h-dvh flex-col xl:h-dvh xl:overflow-hidden">
      <Atmosphere />
      <AnimatePresence>{booting && <BootSequence onDone={finishBoot} />}</AnimatePresence>

      {snapshot ? (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <TopBar
            snapshot={snapshot}
            connection={connection}
            onAutonomy={(mode) => void send({ type: "autonomy", mode })}
            onKill={(on) => void send({ type: "kill", on })}
            onOpenSettings={() => setSettingsOpen(true)}
          />
          <TickerTape tokens={snapshot.watchlist} />

          <motion.main
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="grid min-h-0 flex-1 gap-2 p-2 xl:grid-cols-[264px_minmax(0,1fr)_336px]"
          >
            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <AgentConsole agents={snapshot.agents} tick={snapshot.tick} className="xl:flex-[3]" />
              <DiagnosticsPanel
                diagnostics={snapshot.diagnostics}
                chainStatus={snapshot.chainStatus}
                onRearm={() => void send({ type: "rearm" })}
                onReset={() => void send({ type: "reset" })}
                className="xl:flex-[3]"
              />
              <ApprovalQueue
                approvals={snapshot.approvals}
                autonomy={snapshot.flags.autonomy}
                onApprove={(id) => void send({ type: "approve", id })}
                onReject={(id) => void send({ type: "reject", id })}
                className="xl:flex-[2]"
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <PortfolioPanel portfolio={snapshot.portfolio} className="shrink-0" />
              <WatchlistPanel
                consensus={snapshot.consensus}
                tokens={snapshot.watchlist}
                className="xl:flex-[3]"
              />
              <PositionsPanel
                positions={snapshot.positions}
                onClose={(positionId) => void send({ type: "close", positionId })}
                className="xl:flex-[2]"
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <SignalFeed logs={snapshot.logs} className="xl:flex-[3]" />
              <TradeLog
                trades={snapshot.closedTrades}
                fills={snapshot.fills}
                className="xl:flex-[2]"
              />
            </div>
          </motion.main>

          <ChainStatusBar statuses={snapshot.chainStatus} />

          <SettingsDrawer
            open={settingsOpen}
            risk={snapshot.risk}
            onClose={() => setSettingsOpen(false)}
            onApply={(patch) => void send({ type: "risk", patch })}
            onReset={() => void send({ type: "reset" })}
          />
        </div>
      ) : (
        <div className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4">
          <div className="radar" aria-hidden>
            <span className="radar-ring" />
            <span className="radar-ring delay" />
            <span className="radar-core" />
          </div>
          <div className="text-[12px] tracking-[0.18em] uppercase" style={{ color: "var(--text-muted)" }}>
            connecting to the desk
            <span className="thinking-dots">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
