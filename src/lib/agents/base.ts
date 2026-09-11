import type {
  AgentDescriptor,
  AgentId,
  AgentRuntimeState,
  EngineFlags,
  LogLevel,
  RiskConfig,
  Signal,
} from "@/lib/types";
import type { Blackboard } from "./blackboard";
import type { PaperWallet } from "@/lib/trading/wallet";
import { ROSTER } from "./roster";

export interface AgentContext {
  tick: number;
  board: Blackboard;
  wallet: PaperWallet;
  risk: RiskConfig;
  flags: EngineFlags;
  log: (level: LogLevel, message: string, extra?: { tokenSymbol?: string; meta?: Record<string, string | number | boolean> }) => void;
}

export abstract class Agent {
  readonly descriptor: AgentDescriptor;
  protected activity = "standby";
  protected status: AgentRuntimeState["status"] = "idle";
  protected decisions = 0;
  protected lastActiveAt = 0;
  protected load = 0;
  protected augmented = false;

  constructor(id: AgentId) {
    this.descriptor = ROSTER[id];
  }

  /** One cycle of work. Implementations must not throw — the loop is shared. */
  abstract run(ctx: AgentContext): Promise<void> | void;

  state(): AgentRuntimeState {
    return {
      ...this.descriptor,
      status: this.status,
      activity: this.activity,
      decisions: this.decisions,
      lastActiveAt: this.lastActiveAt,
      load: this.load,
      augmented: this.augmented,
    };
  }

  protected working(activity: string, load = 0.6): void {
    this.status = "thinking";
    this.activity = activity;
    this.load = load;
    this.lastActiveAt = Date.now();
  }

  protected acted(activity: string, count = 1): void {
    this.status = "acting";
    this.activity = activity;
    this.decisions += count;
    this.lastActiveAt = Date.now();
    this.load = Math.min(1, this.load + 0.2);
  }

  protected settle(activity: string): void {
    this.status = "idle";
    this.activity = activity;
    this.load = Math.max(0, this.load * 0.6);
  }

  protected blocked(activity: string): void {
    this.status = "blocked";
    this.activity = activity;
    this.lastActiveAt = Date.now();
  }

  protected signal(
    tokenId: string,
    score: number,
    confidence: number,
    label: string,
    reasons: string[],
    veto = false,
  ): Signal {
    return {
      agent: this.descriptor.id,
      tokenId,
      score: Math.max(-100, Math.min(100, score)),
      confidence: Math.max(0, Math.min(1, confidence)),
      label,
      reasons,
      veto,
      createdAt: Date.now(),
    };
  }
}
