import { getOrchestrator } from "@/lib/agents/orchestrator";
import type { AutonomyMode, RiskConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Command =
  | { type: "autonomy"; mode: AutonomyMode }
  | { type: "kill"; on: boolean }
  | { type: "approve"; id: string }
  | { type: "reject"; id: string }
  | { type: "close"; positionId: string }
  | { type: "risk"; patch: Partial<RiskConfig> }
  | { type: "rearm" }
  | { type: "reset" };

/** Every operator action funnels through here so the desk stays the one authority. */
export async function POST(request: Request): Promise<Response> {
  const desk = getOrchestrator();
  let command: Command;
  try {
    command = (await request.json()) as Command;
  } catch {
    return Response.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  switch (command.type) {
    case "autonomy":
      if (command.mode !== "auto" && command.mode !== "manual") {
        return Response.json({ ok: false, error: "unknown autonomy mode" }, { status: 400 });
      }
      desk.setAutonomy(command.mode);
      break;
    case "kill":
      desk.setKillSwitch(Boolean(command.on));
      break;
    case "approve":
      await desk.approve(String(command.id));
      break;
    case "reject":
      desk.reject(String(command.id));
      break;
    case "close":
      await desk.closePosition(String(command.positionId));
      break;
    case "risk":
      desk.updateRisk(command.patch ?? {});
      break;
    case "rearm":
      desk.rearmDailyLimit();
      break;
    case "reset":
      desk.resetBook();
      break;
    default:
      return Response.json({ ok: false, error: "unknown command" }, { status: 400 });
  }

  return Response.json({ ok: true, snapshot: desk.snapshot() });
}
