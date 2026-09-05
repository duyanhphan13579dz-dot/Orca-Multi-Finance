import { NextResponse } from "next/server";
import type { ApiResponse, Meta } from "./types";
import { buildMeta } from "./freshness";

/**
 * Standard response envelope (§32 of the spec):
 * success → { success: true, data, meta }
 * failure → { success: false, error: { code, message }, meta? }
 */

function isCompleteMeta(x: unknown): x is Meta {
  return Boolean(x) && typeof x === "object" && "freshness" in (x as Record<string, unknown>) && "sourceTimestamp" in (x as Record<string, unknown>);
}

export function ok<T>(
  data: T,
  meta?: Meta | (Partial<Parameters<typeof buildMeta>[0]> & { source?: string }),
): NextResponse<ApiResponse<T>> {
  const m: Meta = isCompleteMeta(meta)
    ? meta
    : buildMeta({
        source: meta?.source ?? "internal",
        sourceTimestampMs: (meta as { sourceTimestampMs?: number | null } | undefined)?.sourceTimestampMs ?? Date.now(),
        hasData: data != null,
        ...(meta ?? {}),
      });
  return NextResponse.json({ success: true, data, meta: m }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export function fail(code: string, message: string, status = 502, meta?: Meta): NextResponse<ApiResponse<never>> {
  return NextResponse.json(
    { success: false, error: { code, message }, meta },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/** unavailable upstream: explicit code so the UI can render UNAVAILABLE honestly */
export function unavailable(source: string, note: string): NextResponse<ApiResponse<never>> {
  const meta = buildMeta({ source, sourceTimestampMs: null, hasData: false, note });
  return fail("UPSTREAM_UNAVAILABLE", note, 502, meta);
}

export function badRequest(message: string): NextResponse<ApiResponse<never>> {
  return fail("BAD_REQUEST", message, 400);
}

export function notFound(message: string): NextResponse<ApiResponse<never>> {
  return fail("NOT_FOUND", message, 404);
}
