import { getOrchestrator } from "@/lib/agents/orchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One-shot snapshot — used for the first paint before the SSE stream attaches. */
export async function GET(): Promise<Response> {
  return Response.json(getOrchestrator().snapshot());
}
