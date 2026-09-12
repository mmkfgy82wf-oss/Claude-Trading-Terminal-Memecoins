"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AutonomyMode, RiskConfig, TerminalSnapshot } from "@/lib/types";

type Command =
  | { type: "autonomy"; mode: AutonomyMode }
  | { type: "kill"; on: boolean }
  | { type: "approve"; id: string }
  | { type: "reject"; id: string }
  | { type: "close"; positionId: string }
  | { type: "risk"; patch: Partial<RiskConfig> }
  | { type: "rearm" }
  | { type: "reset" };

export type ConnectionState = "connecting" | "live" | "reconnecting";

/**
 * Subscribes to the desk's SSE stream and exposes a command channel.
 *
 * The stream is the single source of truth: commands POST and then wait for the
 * next snapshot rather than mutating local state, so the UI can never drift
 * from what the desk actually did.
 */
export function useTerminal() {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const source = new EventSource("/api/stream");
      sourceRef.current = source;

      source.onmessage = (event) => {
        try {
          setSnapshot(JSON.parse(event.data) as TerminalSnapshot);
          setConnection("live");
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };
      source.onerror = () => {
        source.close();
        if (cancelled) return;
        setConnection("reconnecting");
        retry = setTimeout(connect, 2500);
      };
    };

    connect();
    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      sourceRef.current?.close();
    };
  }, []);

  const send = useCallback(async (command: Command) => {
    try {
      const res = await fetch("/api/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      const json = (await res.json()) as { ok: boolean; snapshot?: TerminalSnapshot };
      if (json.snapshot) setSnapshot(json.snapshot);
    } catch {
      // The next SSE frame will re-sync; nothing to roll back locally.
    }
  }, []);

  return { snapshot, connection, send };
}
