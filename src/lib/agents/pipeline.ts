import type { AgentContext } from "./base";
import type { ExecutorAgent } from "./executor";
import type { NarratorAgent } from "./narrator";
import type { QuantAgent } from "./quant";
import type { RiskAgent } from "./risk";
import type { ScoutAgent } from "./scout";
import type { SentinelAgent } from "./sentinel";
import type { AgentId } from "@/lib/types";

/**
 * One pass of the desk, in pipeline order.
 *
 * This exists so the backtest and the live orchestrator cannot drift apart. A
 * replay that ran its own copy of this sequence would be measuring a second
 * implementation of the desk rather than the one that trades, and the first
 * time someone reordered a stage here the backtest would quietly keep
 * validating the old order.
 *
 * Order matters: discovery → safety → signal → story → sizing → execution.
 * SENTINEL runs before QUANT so a veto is on the board before anything scores
 * conviction on it, and RISK runs last of the analysts so it sizes against
 * a settled consensus.
 */
export interface DeskAgents {
  scout: ScoutAgent;
  sentinel: SentinelAgent;
  quant: QuantAgent;
  narrator: NarratorAgent;
  risk: RiskAgent;
  executor: ExecutorAgent;
}

export async function runDeskCycle(
  agents: DeskAgents,
  contextFor: (agent: AgentId) => AgentContext,
  routeIntents: (ctx: AgentContext) => Promise<void>,
): Promise<void> {
  agents.scout.run(contextFor("scout"));
  await agents.sentinel.run(contextFor("sentinel"));
  agents.quant.run(contextFor("quant"));
  await agents.narrator.run(contextFor("narrator"));
  agents.risk.run(contextFor("risk"));

  const execCtx = contextFor("executor");
  await routeIntents(execCtx);
  await agents.executor.run(execCtx);
}
