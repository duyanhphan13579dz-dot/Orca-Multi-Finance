import { NextRequest, NextResponse } from "next/server";
import { hubPortfolioMarks, runInDataHub, listAssetTypes } from "@/lib/data-engine";
import { buildMeta } from "@/lib/freshness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PosIn = { assetType?: string; symbol: string };

/**
 * POST /api/v1/portfolio/marks
 * Body: { positions: [{ assetType?, symbol }] }
 * — một pipeline hub cho nhật ký + smart portfolio, tự nhận loại tài sản.
 *
 * GET ?symbols=FPT,BTC,EURUSD&types=stock,crypto,forex
 */
export async function POST(req: NextRequest) {
  let body: { positions?: PosIn[] } = {};
  try {
    body = (await req.json()) as { positions?: PosIn[] };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const positions = Array.isArray(body.positions) ? body.positions.slice(0, 80) : [];
  if (!positions.length) {
    return NextResponse.json({
      rows: [],
      marks: {},
      sources: [],
      byType: {},
      assetTypes: listAssetTypes().map((a) => ({ id: a.id, labelVi: a.labelVi })),
      meta: buildMeta({ source: "hub-portfolio-marks", sourceTimestampMs: Date.now(), note: "empty" }),
    });
  }

  const result = await runInDataHub(async () => hubPortfolioMarks(positions));
  return NextResponse.json({
    rows: result.rows,
    marks: result.marks,
    sources: result.sources,
    byType: result.byType,
    assetTypes: listAssetTypes().map((a) => ({ id: a.id, labelVi: a.labelVi })),
    meta: buildMeta({
      source: result.sources.join("+") || "hub-portfolio-marks",
      sourceTimestampMs: Date.now(),
      note: `${result.rows.length} marks · ${positions.length} positions`,
    }),
  });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const symbols = (sp.get("symbols") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 80);
  const types = (sp.get("types") ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const positions: PosIn[] = symbols.map((symbol, i) => ({
    symbol,
    assetType: types[i] ?? types[0] ?? undefined,
  }));
  if (!positions.length) {
    return NextResponse.json({
      rows: [],
      marks: {},
      sources: [],
      byType: {},
      assetTypes: listAssetTypes().map((a) => ({ id: a.id, labelVi: a.labelVi })),
      meta: buildMeta({ source: "hub-portfolio-marks", sourceTimestampMs: Date.now(), note: "empty" }),
    });
  }
  const result = await runInDataHub(async () => hubPortfolioMarks(positions));
  return NextResponse.json({
    rows: result.rows,
    marks: result.marks,
    sources: result.sources,
    byType: result.byType,
    assetTypes: listAssetTypes().map((a) => ({ id: a.id, labelVi: a.labelVi })),
    meta: buildMeta({
      source: result.sources.join("+") || "hub-portfolio-marks",
      sourceTimestampMs: Date.now(),
      note: `${result.rows.length} marks · ${positions.length} positions`,
    }),
  });
}
