import "server-only";
import { NextResponse } from "next/server";
import { ok, unavailable } from "./envelope";
import {
  runGuarded,
  guardMeta,
  isIsolateCoolingDown,
  markIsolateOverload,
  type GuardOpts,
} from "./data-engine/workers-guard";
import type { Meta } from "./types";

/** P5-E: coalesce concurrent identical produces (same label) within one isolate. */
const produceInflight = new Map<string, Promise<{ data: unknown; meta?: Meta; headers?: Record<string, string> } | null>>();

/**
 * Wrap heavy API handlers so they never surface as Worker 1102 when possible.
 * - Runs under request budget (subrequest + wall + concurrency)
 * - On overload / throw → try `fallback()` then soft 200 partial or honest unavailable
 */

export async function safeApi<T>(
  opts: {
    label: string;
    guard?: GuardOpts;
    produce: () => Promise<{ data: T; meta?: Meta; headers?: Record<string, string> } | null>;
    fallback?: () => Promise<{ data: T; meta?: Meta } | null> | { data: T; meta?: Meta } | null;
    unavailableSource?: string;
    unavailableNote?: string;
  },
): Promise<NextResponse> {
  if (isIsolateCoolingDown()) {
    try {
      const fb = await opts.fallback?.();
      if (fb?.data != null) {
        return ok(
          fb.data,
          {
            ...(fb.meta ?? {}),
            partial: true,
            stale: true,
            note: `${fb.meta?.note ?? ""} · isolate cooldown`.trim(),
          } as Meta,
          {
            "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
            "X-Orca-Mode": "cooldown",
          },
        );
      }
    } catch {
      /* */
    }
    return unavailable(
      opts.unavailableSource ?? opts.label,
      opts.unavailableNote ?? "Hệ thống đang giảm tải tạm thời — thử lại sau vài giây.",
    );
  }

  try {
    // P5-E: share in-flight produce for same label (dashboard multi-call)
    let result: { data: unknown; meta?: Meta; headers?: Record<string, string> } | null;
    const coalesceKey = opts.label;
    const existing = produceInflight.get(coalesceKey);
    if (existing) {
      result = await existing;
    } else {
      const p = runGuarded(opts.produce, {
        label: opts.label,
        ...(opts.guard ?? {}),
      }).finally(() => produceInflight.delete(coalesceKey));
      produceInflight.set(coalesceKey, p as Promise<{ data: unknown; meta?: Meta; headers?: Record<string, string> } | null>);
      result = await p;
    }

    const gm = guardMeta();
    if (result?.data != null) {
      const meta = {
        ...(result.meta ?? {}),
        ...(gm?.overload
          ? { partial: true, note: `${result.meta?.note ?? ""} · budget-capped`.trim() }
          : {}),
      } as Meta;
      return ok(result.data, meta, {
        ...(result.headers ?? {}),
        ...(gm
          ? { "X-Orca-Subreq": String(gm.subrequests), "X-Orca-Elapsed": String(gm.elapsedMs) }
          : {}),
      });
    }

    const fb = await opts.fallback?.();
    if (fb?.data != null) {
      return ok(
        fb.data,
        {
          ...(fb.meta ?? {}),
          partial: true,
          stale: true,
          note: `${fb.meta?.note ?? ""} · fallback`.trim(),
        } as Meta,
        {
          "Cache-Control": "private, max-age=5, stale-while-revalidate=30",
          "X-Orca-Mode": "fallback",
        },
      );
    }

    if (gm?.overload) markIsolateOverload();
    return unavailable(
      opts.unavailableSource ?? opts.label,
      opts.unavailableNote ?? "Chưa có dữ liệu — đang thử lại.",
    );
  } catch (e) {
    markIsolateOverload();
    try {
      const fb = await opts.fallback?.();
      if (fb?.data != null) {
        return ok(
          fb.data,
          {
            ...(fb.meta ?? {}),
            partial: true,
            stale: true,
            note: `${fb.meta?.note ?? ""} · after-error`.trim(),
          } as Meta,
          {
            "Cache-Control": "private, max-age=3, stale-while-revalidate=20",
            "X-Orca-Mode": "error-fallback",
          },
        );
      }
    } catch {
      /* */
    }
    const msg = e instanceof Error ? e.message : "Lỗi không xác định";
    return unavailable(opts.unavailableSource ?? opts.label, msg);
  }
}
