import "server-only";

/**
 * Cloudflare Workers do not keep long-lived SSE connections reliably.
 * Prefer short JSON polls. SSE remains for Node/local only, and is capped.
 */

export function prefersJsonPoll(req: Request): boolean {
  const accept = req.headers.get("accept") ?? "";
  if (accept.includes("application/json") && !accept.includes("text/event-stream")) return true;
  if (req.headers.get("x-orca-realtime") === "poll") return true;
  const url = new URL(req.url);
  if (url.searchParams.get("mode") === "poll") return true;
  // Workers: force poll unless client explicitly asks for SSE
  const isWorkers =
    process.env.CLOUDFLARE_WORKERS === "1" || process.env.NEXT_RUNTIME === "edge";
  if (isWorkers && !accept.includes("text/event-stream")) return true;
  return false;
}

export function sseHeaders(): HeadersInit {
  return {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Realtime-Mode": "sse",
    "X-Realtime-Hint": "On Cloudflare Workers prefer ?mode=poll or Accept: application/json",
  };
}

export function pollHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Realtime-Mode": "poll",
    "X-Realtime-Hint": "Poll every 2–5s; SSE is not durable on Workers isolates",
  };
}
