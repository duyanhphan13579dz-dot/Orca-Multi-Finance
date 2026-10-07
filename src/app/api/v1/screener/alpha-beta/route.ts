import { ok, unavailable, badRequest } from "@/lib/envelope";
import { screenAlphaBeta } from "@/lib/services/alpha-beta-screener";
import type { AlphaBetaProfile } from "@/lib/engines/alpha-beta";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROFILES = new Set([
  "any",
  "alpha_high_beta_low",
  "alpha_high_beta_high",
  "alpha_flat_beta_high",
  "alpha_neg_beta_low",
  "alpha_neg_beta_high",
  "insufficient",
]);

/** GET /api/v1/screener/alpha-beta — Hệ số cổ phiếu (Alpha · Beta) */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const profileRaw = (url.searchParams.get("profile") ?? "any").toLowerCase();
  if (!PROFILES.has(profileRaw)) return badRequest("profile không hợp lệ");

  const minAlphaT = Number(url.searchParams.get("minAlphaT") ?? "0");
  const maxBeta = Number(url.searchParams.get("maxBeta") ?? "99");
  const minBeta = Number(url.searchParams.get("minBeta") ?? "-99");
  const requireReliable = url.searchParams.get("reliable") === "1";
  const limit = Number(url.searchParams.get("limit") ?? 40);
  const sector = url.searchParams.get("sector") ?? "";
  const symbolsRaw = url.searchParams.get("symbols") ?? "";
  const symbols = symbolsRaw
    ? symbolsRaw
        .split(/[,;\s]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined;

  try {
    const r = await screenAlphaBeta({
      profile: profileRaw as AlphaBetaProfile | "any",
      minAlphaT: Number.isFinite(minAlphaT) ? minAlphaT : 0,
      maxBeta: Number.isFinite(maxBeta) ? maxBeta : 99,
      minBeta: Number.isFinite(minBeta) ? minBeta : -99,
      requireReliable,
      limit: Number.isFinite(limit) ? limit : 40,
      sector: sector || undefined,
      symbols,
    });
    return ok(
      {
        rows: r.rows,
        scanned: r.scanned,
        skipped: r.skipped,
        filters: {
          profile: profileRaw,
          minAlphaT,
          maxBeta,
          minBeta,
          requireReliable,
        },
        engine: "CAPM weekly · VNINDEX · alpha t-stat · β adj/Dimson",
      },
      r.meta,
    );
  } catch (e) {
    return unavailable(
      "alpha-beta-screener",
      e instanceof Error ? e.message : "scan failed",
    );
  }
}
