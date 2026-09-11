import type { AgentDescriptor, AgentId } from "@/lib/types";

/**
 * Agent colours come from the terminal's categorical palette, which is
 * validated for the dark surface (#0a0b10): lightness band, chroma floor,
 * adjacent-pair CVD separation and >=3:1 contrast all pass. Colour is never the
 * only cue — every agent also carries a glyph and its call-sign.
 */
export const ROSTER: Record<AgentId, AgentDescriptor> = {
  scout: {
    id: "scout",
    name: "SCOUT",
    role: "Discovery",
    color: "#07a4ba",
    glyph: "◈",
  },
  sentinel: {
    id: "sentinel",
    name: "SENTINEL",
    role: "Rug defence",
    color: "#d9730b",
    glyph: "⛨",
  },
  quant: {
    id: "quant",
    name: "QUANT",
    role: "Momentum & flow",
    color: "#987ce9",
    glyph: "∿",
  },
  narrator: {
    id: "narrator",
    name: "NARRATOR",
    role: "Narrative & meme fit",
    color: "#03af58",
    glyph: "❝",
  },
  risk: {
    id: "risk",
    name: "RISK",
    role: "Sizing & exposure",
    color: "#dd5da2",
    glyph: "⚖",
  },
  executor: {
    id: "executor",
    name: "EXECUTOR",
    role: "Fills & exits",
    color: "#07a4ba",
    glyph: "▶",
  },
};

export const AGENT_ORDER: AgentId[] = ["scout", "sentinel", "quant", "narrator", "risk", "executor"];

/**
 * Consensus weights. SENTINEL has no weight because it does not vote — it
 * vetoes, which is a stronger power than any weight could express.
 */
export const CONSENSUS_WEIGHTS: Partial<Record<AgentId, number>> = {
  scout: 0.2,
  quant: 0.5,
  narrator: 0.3,
};
