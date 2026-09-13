"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentId, ClosedTrade, Fill, TerminalSnapshot } from "@/lib/types";
import { armAudio, playDeskSound } from "./deskSound";

export interface DeskToast {
  id: string;
  title: string;
  body: string;
  tone: "pos" | "neg" | "info";
}

const SOUND_KEY = "memedesk.sound";

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

/**
 * Operator chrome that never talks to the engine: inspect, palette, toasts,
 * hotkeys, sound. The snapshot is read-only input.
 */
export function useDeskChrome(
  snapshot: TerminalSnapshot | null,
  actions: {
    onAutonomy: (mode: "auto" | "manual") => void;
    onKill: (on: boolean) => void;
    onOpenSettings: () => void;
  },
  ready = true,
) {
  const [inspectId, setInspectId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedAgent, setFeedAgent] = useState<AgentId | null>(null);
  const [sound, setSound] = useState(false);
  const [toasts, setToasts] = useState<DeskToast[]>([]);
  const [burst, setBurst] = useState<"win" | "loss" | null>(null);
  const [sessionStartedAt] = useState(() => Date.now());
  const seenFills = useRef<Set<string>>(new Set());
  const seenTrades = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    try {
      setSound(window.localStorage.getItem(SOUND_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);

  const toggleSound = useCallback(() => {
    setSound((on) => {
      const next = !on;
      if (next) {
        armAudio();
        playDeskSound("ui");
      }
      try {
        window.localStorage.setItem(SOUND_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const inspect = useCallback((tokenId: string | null) => {
    setInspectId(tokenId);
    setPaletteOpen(false);
    setHelpOpen(false);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((toast: DeskToast, kind?: "buy" | "sell" | "win" | "loss") => {
    setToasts((list) => [toast, ...list].slice(0, 4));
    window.setTimeout(() => dismissToast(toast.id), 5200);
    if (soundRef.current && kind) playDeskSound(kind);
  }, [dismissToast]);

  useEffect(() => {
    if (!snapshot) return;
    const fills = snapshot.fills;
    const trades = snapshot.closedTrades;
    if (!primed.current) {
      for (const fill of fills) seenFills.current.add(fill.id);
      for (const trade of trades) seenTrades.current.add(trade.id);
      primed.current = true;
      return;
    }
    if (!ready) return;
    const freshFills: Fill[] = [];
    for (const fill of fills) {
      if (!seenFills.current.has(fill.id)) {
        seenFills.current.add(fill.id);
        freshFills.push(fill);
      }
    }
    const freshTrades: ClosedTrade[] = [];
    for (const trade of trades) {
      if (!seenTrades.current.has(trade.id)) {
        seenTrades.current.add(trade.id);
        freshTrades.push(trade);
      }
    }
    for (const trade of freshTrades) {
      const win = trade.outcome === "win";
      pushToast(
        {
          id: `t-${trade.id}`,
          title: win ? `WIN  ${trade.symbol}` : `LOSS  ${trade.symbol}`,
          body: `${win ? "+" : ""}${trade.pnlPct.toFixed(1)}% · ${trade.exitReason}`,
          tone: win ? "pos" : "neg",
        },
        win ? "win" : "loss",
      );
      setBurst(win ? "win" : "loss");
      window.setTimeout(() => setBurst(null), 900);
    }
    for (const fill of freshFills) {
      // A closing fill is already toasted as a round trip.
      if (freshTrades.some((t) => t.symbol === fill.symbol && Math.abs(t.closedAt - fill.at) < 2000)) continue;
      pushToast(
        {
          id: `f-${fill.id}`,
          title: `${fill.side.toUpperCase()}  ${fill.symbol}`,
          body: `${fill.valueNative.toFixed(4)} ${fill.quote} · ${fill.reason}`,
          tone: fill.side === "buy" ? "info" : "neg",
        },
        fill.side === "buy" ? "buy" : "sell",
      );
    }
  }, [snapshot, pushToast, ready]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
    else void document.exitFullscreen?.();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        setHelpOpen(false);
        return;
      }
      if (event.key === "Escape") {
        setPaletteOpen(false);
        setHelpOpen(false);
        setInspectId(null);
        return;
      }
      if (typingInField(event.target)) return;
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        setPaletteOpen(false);
        return;
      }
      if (event.key === "/" ) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key.toLowerCase() === "a" && !mod) {
        actionsRef.current.onAutonomy("auto");
        return;
      }
      if (event.key.toLowerCase() === "m" && !mod) {
        actionsRef.current.onAutonomy("manual");
        return;
      }
      if (event.key.toLowerCase() === "r" && !mod) {
        actionsRef.current.onOpenSettings();
        return;
      }
      if (event.key.toLowerCase() === "s" && !mod) {
        toggleSound();
        return;
      }
      if (event.key.toLowerCase() === "f" && !mod) {
        toggleFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, toggleSound]);

  const cycleFeedAgent = useCallback((id: AgentId) => {
    setFeedAgent((current) => (current === id ? null : id));
  }, []);

  return {
    inspectId,
    inspect,
    paletteOpen,
    setPaletteOpen,
    helpOpen,
    setHelpOpen,
    feedAgent,
    cycleFeedAgent,
    sound,
    toggleSound,
    toasts,
    dismissToast,
    burst,
    sessionStartedAt,
    toggleFullscreen,
  };
}
