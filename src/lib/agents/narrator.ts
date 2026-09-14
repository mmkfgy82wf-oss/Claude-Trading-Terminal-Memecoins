import { now } from "@/lib/util/clock";
import type { Token } from "@/lib/types";
import { Agent, type AgentContext } from "./base";

/**
 * NARRATOR — reads the story, not the chart.
 *
 * Memecoins trade on legibility: a ticker people can retell spreads, a random
 * string does not. The deterministic layer scores meme-fit from the name, the
 * ticker shape and the crowd structure (holders arriving vs. one whale). When
 * ANTHROPIC_API_KEY is present the same job is additionally put to Claude,
 * whose read is blended in — the agent never *depends* on it.
 */

const MEME_LEXICON = [
  "dog", "inu", "shib", "cat", "kitty", "pepe", "frog", "moon", "rocket", "elon",
  "trump", "wif", "hat", "bonk", "wojak", "chad", "sigma", "based", "ai", "agent",
  "gpt", "banana", "monke", "ape", "goat", "turbo", "meme", "coin", "baby", "mini",
  "giga", "mega", "hyper", "nyan", "doge", "floki", "popcat", "snek", "toad",
];

const FATIGUE_LEXICON = ["safe", "moon2", "x1000", "elonmusk2", "v2", "v3", "reborn", "classic"];

interface ClaudeRead {
  score: number;
  thesis: string;
}

export class NarratorAgent extends Agent {
  private readonly claudeCache = new Map<string, { at: number; read: ClaudeRead }>();
  private inFlight = 0;

  constructor() {
    super("narrator");
  }

  async run(ctx: AgentContext): Promise<void> {
    const watchlist = ctx.board.watchlistTokens();
    this.augmented = ctx.flags.providers.anthropic;
    this.working(`reading ${watchlist.length} narratives`, Math.min(1, watchlist.length / 14));

    for (const token of watchlist) {
      const base = this.readNarrative(token);
      let score = base.score;
      let reasons = base.reasons;

      const claude = this.claudeCache.get(token.id)?.read;
      if (claude) {
        // Claude informs, it does not override: 60/40 toward the measurable part.
        score = base.score * 0.6 + claude.score * 0.4;
        reasons = [`claude: ${claude.thesis}`, ...base.reasons].slice(0, 4);
      }

      ctx.board.publish(
        this.signal(
          token.id,
          score,
          claude ? 0.75 : 0.5,
          score >= 65 ? "strong narrative" : score >= 35 ? "recognisable" : "no story",
          reasons,
        ),
      );
    }

    // Only the top candidates are worth an LLM call, and only a couple per tick.
    if (ctx.flags.providers.anthropic) {
      const top = ctx.board
        .consensus()
        .filter((c) => c.verdict !== "vetoed")
        .slice(0, 2)
        .map((c) => ctx.board.token(c.tokenId))
        .filter((t): t is Token => Boolean(t))
        .filter((t) => {
          const cached = this.claudeCache.get(t.id);
          return !cached || now() - cached.at > 10 * 60_000;
        });
      for (const token of top) void this.askClaude(token, ctx);
    }

    this.acted(
      this.inFlight > 0 ? `${this.inFlight} claude read(s) in flight` : "narratives scored",
      watchlist.length ? 1 : 0,
    );
  }

  /** Deterministic meme-fit — always available, no key required. */
  private readNarrative(token: Token): { score: number; reasons: string[] } {
    const haystack = `${token.symbol} ${token.name}`.toLowerCase();
    const reasons: string[] = [];
    let score = 20;

    const hits = MEME_LEXICON.filter((w) => haystack.includes(w));
    if (hits.length) {
      score += Math.min(30, hits.length * 14);
      reasons.push(`meme anchor: ${hits.slice(0, 3).join(", ")}`);
    } else {
      score -= 10;
      reasons.push("no recognisable meme anchor");
    }

    const fatigue = FATIGUE_LEXICON.filter((w) => haystack.includes(w));
    if (fatigue.length) {
      score -= 22;
      reasons.push(`derivative naming (${fatigue[0]})`);
    }

    // A ticker people can say out loud travels further than one they cannot.
    const ticker = token.symbol.replace(/[^A-Z]/gi, "");
    if (ticker.length >= 3 && ticker.length <= 7) {
      score += 12;
      reasons.push(`clean ticker (${ticker.length} chars)`);
    } else if (ticker.length > 10) {
      score -= 12;
      reasons.push("unwieldy ticker");
    }

    // Crowd structure: many small buys reads as a crowd, few large ones as one desk.
    const trades = token.buys5m + token.sells5m;
    const avgTradeUsd = token.volume5mUsd / Math.max(1, trades);
    if (trades > 60 && avgTradeUsd < 400) {
      score += 20;
      reasons.push(`retail crowd (${trades} trades, ~$${avgTradeUsd.toFixed(0)} avg)`);
    } else if (trades > 8 && avgTradeUsd > 3_000) {
      score -= 15;
      reasons.push(`few large tickets (~$${avgTradeUsd.toFixed(0)} avg)`);
    }

    // Attention decays; a story that has been running for days is late.
    if (token.ageMinutes > 60 * 72) {
      score -= 12;
      reasons.push("story is days old");
    }

    return { score: Math.max(-100, Math.min(100, score)), reasons: reasons.slice(0, 4) };
  }

  /** Optional Claude read. Fire-and-forget: results land in the next tick. */
  private async askClaude(token: Token, ctx: AgentContext): Promise<void> {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key || this.inFlight >= 2) return;
    this.inFlight += 1;

    const prompt = [
      "You rate memecoin narratives for a trading desk. Answer with JSON only.",
      "",
      `Ticker: ${token.symbol}`,
      `Name: ${token.name}`,
      `Chain: ${token.chain}`,
      `Age: ${token.ageMinutes} minutes`,
      `Liquidity: $${Math.round(token.liquidityUsd)}`,
      `24h volume: $${Math.round(token.volume24hUsd)}`,
      `5m buys/sells: ${token.buys5m}/${token.sells5m}`,
      `Change 5m/1h/24h: ${token.change5m.toFixed(1)}% / ${token.change1h.toFixed(1)}% / ${token.change24h.toFixed(1)}%`,
      "",
      'Return {"score": <-100..100 narrative strength>, "thesis": "<max 12 words>"}.',
      "Score the story's spreadability only — the desk scores price separately.",
    ].join("\n");

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
          max_tokens: 150,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = json.content?.find((c) => c.type === "text")?.text ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("no json in response");
      const parsed = JSON.parse(match[0]) as { score?: number; thesis?: string };
      const score = Number(parsed.score);
      if (!Number.isFinite(score)) throw new Error("no score");

      this.claudeCache.set(token.id, {
        at: now(),
        read: {
          score: Math.max(-100, Math.min(100, score)),
          thesis: String(parsed.thesis ?? "").slice(0, 90) || "no thesis returned",
        },
      });
      ctx.log("signal", `claude read ${token.symbol}: ${parsed.thesis ?? score}`, { tokenSymbol: token.symbol });
    } catch (err) {
      ctx.log("warn", `narrative LLM call failed (${(err as Error).message}) — deterministic score stands`);
    } finally {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
  }
}
