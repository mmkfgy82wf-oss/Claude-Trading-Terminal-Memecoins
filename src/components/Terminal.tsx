"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useMemo, useState } from "react";
import { useTerminal } from "@/lib/useTerminal";
import { AgentConsole } from "./AgentConsole";
import { ApprovalQueue } from "./ApprovalQueue";
import { Atmosphere } from "./Atmosphere";
import { BootSequence } from "./BootSequence";
import { ChainStatusBar } from "./ChainStatusBar";
import { CommandPalette } from "./CommandPalette";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { TradeLog } from "./TradeLog";
import { PortfolioPanel } from "./PortfolioPanel";
import { PositionsPanel } from "./PositionsPanel";
import { SettingsDrawer } from "./SettingsDrawer";
import { ShortcutHelp } from "./ShortcutHelp";
import { SignalFeed } from "./SignalFeed";
import { Spotlight } from "./Spotlight";
import { TickerTape } from "./TickerTape";
import { ToastStack } from "./ToastStack";
import { TokenInspector } from "./TokenInspector";
import { TopBar } from "./TopBar";
import { WatchlistPanel } from "./WatchlistPanel";
import { useDeskChrome } from "./useDeskChrome";

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
  const onAutonomy = useCallback((mode: "auto" | "manual") => void send({ type: "autonomy", mode }), [send]);
  const onKill = useCallback((on: boolean) => void send({ type: "kill", on }), [send]);
  const onOpenSettings = useCallback(() => setSettingsOpen(true), []);
  const chrome = useDeskChrome(snapshot, { onAutonomy, onKill, onOpenSettings }, !booting);

  const inspectToken = snapshot?.watchlist.find((t) => t.id === chrome.inspectId) ?? null;
  const inspectView = snapshot?.consensus.find((c) => c.tokenId === chrome.inspectId);
  const inspectPosition = snapshot?.positions.find((p) => p.tokenId === chrome.inspectId);

  const commands = useMemo(
    () => [
      { id: "auto", label: "Go AUTO", hint: "desk fills its own tickets", kbd: "A", run: () => { onAutonomy("auto"); chrome.setPaletteOpen(false); } },
      { id: "manual", label: "Go MANUAL", hint: "review every entry", kbd: "M", run: () => { onAutonomy("manual"); chrome.setPaletteOpen(false); } },
      { id: "risk", label: "Risk parameters", hint: "size, stops, liquidity floors", kbd: "R", run: () => { onOpenSettings(); chrome.setPaletteOpen(false); } },
      { id: "sound", label: chrome.sound ? "Mute desk sounds" : "Arm desk sounds", hint: "fills and round-trips", kbd: "S", run: () => { chrome.toggleSound(); chrome.setPaletteOpen(false); } },
      { id: "full", label: "Fullscreen", hint: "cinema the desk", kbd: "F", run: () => { chrome.toggleFullscreen(); chrome.setPaletteOpen(false); } },
      { id: "help", label: "Keyboard cheat sheet", hint: "every shortcut", kbd: "?", run: () => { chrome.setHelpOpen(true); chrome.setPaletteOpen(false); } },
      {
        id: "kill",
        label: snapshot?.flags.killSwitch ? "Release kill switch" : "Kill switch — flatten",
        hint: "sells every open position",
        run: () => {
          onKill(!snapshot?.flags.killSwitch);
          chrome.setPaletteOpen(false);
        },
      },
    ],
    [chrome, onAutonomy, onKill, onOpenSettings, snapshot?.flags.killSwitch],
  );

  return (
    <div className="relative flex min-h-dvh flex-col xl:h-dvh xl:overflow-hidden">
      <Atmosphere />
      <AnimatePresence>{booting && <BootSequence onDone={finishBoot} />}</AnimatePresence>

      {snapshot ? (
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <TopBar
            snapshot={snapshot}
            connection={connection}
            sessionStartedAt={chrome.sessionStartedAt}
            sound={chrome.sound}
            onAutonomy={onAutonomy}
            onKill={onKill}
            onOpenSettings={onOpenSettings}
            onOpenPalette={() => chrome.setPaletteOpen(true)}
            onOpenHelp={() => chrome.setHelpOpen(true)}
            onToggleSound={chrome.toggleSound}
          />
          <TickerTape tokens={snapshot.watchlist} onInspect={chrome.inspect} />
          <Spotlight tokens={snapshot.watchlist} consensus={snapshot.consensus} onInspect={chrome.inspect} />

          <motion.main
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="grid min-h-0 flex-1 gap-2 p-2 xl:grid-cols-[264px_minmax(0,1fr)_336px]"
          >
            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <AgentConsole
                agents={snapshot.agents}
                tick={snapshot.tick}
                selectedId={chrome.feedAgent}
                onSelect={chrome.cycleFeedAgent}
                className="xl:flex-[3]"
              />
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
                selectedId={chrome.inspectId}
                onInspect={chrome.inspect}
                className="xl:flex-[3]"
              />
              <PositionsPanel
                positions={snapshot.positions}
                onClose={(positionId) => void send({ type: "close", positionId })}
                onInspect={chrome.inspect}
                className="xl:flex-[2]"
              />
            </div>

            <div className="flex min-h-0 min-w-0 flex-col gap-2">
              <SignalFeed
                logs={snapshot.logs}
                agentFilter={chrome.feedAgent}
                onClearFilter={() => chrome.feedAgent && chrome.cycleFeedAgent(chrome.feedAgent)}
                className="xl:flex-[3]"
              />
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

          <TokenInspector
            token={inspectToken}
            view={inspectView}
            position={inspectPosition}
            onClose={() => chrome.inspect(null)}
          />
          <CommandPalette
            open={chrome.paletteOpen}
            tokens={snapshot.watchlist}
            consensus={snapshot.consensus}
            onClose={() => chrome.setPaletteOpen(false)}
            onInspect={chrome.inspect}
            commands={commands}
          />
          <ShortcutHelp open={chrome.helpOpen} onClose={() => chrome.setHelpOpen(false)} />
          <ToastStack toasts={chrome.toasts} burst={chrome.burst} onDismiss={chrome.dismissToast} />
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
