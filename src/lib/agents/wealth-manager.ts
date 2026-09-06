import "server-only";
import { executeTool } from "./tools";
import { numVn, pctVn, type AgentContext, type AgentRun, type AgentSection } from "./agent-types";
import type { FinancialProfile } from "../finance/financial-profile";

/**
 * WEALTH MANAGER AGENT — từ net worth + holdings:
 * giá trị ròng → phân bổ tài sản → đa dạng hóa → tập trung →
 * ngành/tiền tệ/thanh khoản/drawdown/rủi ro danh mục → kế hoạch tái cân bằng.
 * Target allocation là MODEL-INFERENCE (risk profile + tuổi); số hiện tại là FACT.
 */

export async function runWealthManager(ctx: AgentContext): Promise<AgentRun> {
  const trace = ["wealth-manager"];
  const profile = ctx.profile ?? null;
  if (!profile) {
    return {
      agent: "wealth-manager",
      sections: [{
        id: "unavailable",
        title: "Chưa có danh mục",
        label: "FACT",
        body: "Cần Financial Profile có holdings để phân tích danh mục. Hệ thống không đoán tỷ trọng từ câu hỏi.",
        data: null,
        sources: [],
        unavailable: true,
      }],
      narrative: "Chưa có dữ liệu danh mục.",
      symbols: [],
      sources: [],
      freshness: "UNAVAILABLE",
      confidence: null,
      unavailable: ["profile"],
      trace,
    };
  }

  const unavailable: string[] = [];
  const sections: AgentSection[] = [];

  const [portfolio, allocation, concentration, sector, currency, rebal] = await Promise.all([
    executeTool("get_portfolio", {}, { profile }),
    executeTool("asset_allocation", {}, { profile }),
    executeTool("concentration", {}, { profile }),
    executeTool("sector_exposure", {}, { profile }),
    executeTool("currency_exposure", {}, { profile }),
    executeTool("rebalancing_plan", {}, { profile }),
  ]);

  if (portfolio.ok) {
    const p = portfolio.data as { total: number | null; holdings: { id: string; label: string; assetClass: string; value: number; sector?: string | null; currency?: string | null }[] };
    sections.push({
      id: "portfolio",
      title: "Danh mục hiện tại",
      label: "FACT",
      body: `Tổng danh mục ${numVn(p.total)} trên ${p.holdings.length} vị thế.`,
      data: p,
      sources: ["profile"],
    });
  } else unavailable.push("portfolio");

  if (allocation.ok) {
    const a = allocation.data as { rows: { key: string; label: string; value: number; weightPct: number }[]; total: number };
    sections.push({
      id: "allocation",
      title: "Phân bổ tài sản",
      label: "DATA-DRIVEN",
      body: a.rows.map((r) => `${r.label} ${numVn(r.value)} (${r.weightPct.toFixed(1)}%)`).join(" · ") + ".",
      data: a,
      sources: ["allocation-engine"],
    });
  } else unavailable.push("allocation");

  if (concentration.ok) {
    const c = concentration.data as { hhi: number | null; top1Pct: number | null; top3Pct: number | null; largest: { label: string; weightPct: number } | null; holdingsCount: number; level: string };
    sections.push({
      id: "concentration",
      title: "Mức độ tập trung",
      label: "DATA-DRIVEN",
      body: `HHI ${c.hhi ?? "—"} · vị thế lớn nhất ${c.largest?.label ?? "—"} ${c.largest ? `${c.largest.weightPct.toFixed(1)}%` : ""} · ${c.holdingsCount} vị thế → ${c.level}.`,
      data: c,
      sources: ["concentration-engine"],
    });
  } else unavailable.push("concentration");

  if (sector.ok) {
    const s = sector.data as { rows: { sector: string; value: number; weightPct: number }[]; total: number };
    sections.push({
      id: "sector",
      title: "Phơi nhiễm ngành",
      label: "DATA-DRIVEN",
      body: s.rows.map((r) => `${r.sector} ${r.weightPct.toFixed(1)}%`).join(" · ") + ".",
      data: s,
      sources: ["sector-exposure-engine"],
      unavailable: !s.rows.length,
    });
  }

  if (currency.ok) {
    const c = currency.data as { rows: { currency: string; value: number; weightPct: number }[]; total: number };
    sections.push({
      id: "currency",
      title: "Phơi nhiễm tiền tệ",
      label: "DATA-DRIVEN",
      body: c.rows.map((r) => `${r.currency} ${r.weightPct.toFixed(1)}%`).join(" · ") + ".",
      data: c,
      sources: ["currency-exposure-engine"],
      unavailable: !c.rows.length,
    });
  }

  if (rebal.ok) {
    const r = rebal.data as { suggested: { key: string; label: string; currentPct: number; targetPct: number; deltaValue: number; suggestedAction: string }[]; disclaimer: string };
    sections.push({
      id: "rebalancing",
      title: "Kế hoạch tái cân bằng",
      label: "MODEL-INFERENCE",
      body: r.suggested.map((x) => `${x.label}: ${x.currentPct.toFixed(1)}% → ${x.targetPct.toFixed(1)}% (${x.suggestedAction} ${numVn(Math.abs(x.deltaValue))})`).join(" · ") + `. ${r.disclaimer}`,
      data: r,
      sources: ["rebalancing-rules"],
    });
  } else unavailable.push("rebalancing");

  // Thanh khoản (từ profile)
  const liquidity = profile.derive.liquidityRatio.value;
  sections.push({
    id: "liquidity",
    title: "Thanh khoản danh mục",
    label: "DATA-DRIVEN",
    body: liquidity != null
      ? `Tài sản thanh khoản chiếm ${(liquidity * 100).toFixed(0)}% tổng tài sản${liquidity < 0.15 ? " — dưới ngưỡng an toàn, cần cân nhắc" : liquidity < 0.3 ? " — trong vùng theo dõi" : " — đạt ngưỡng 30%"}.`
      : "Chưa khai báo tài sản thanh khoản/tổng tài sản — không đánh giá được.",
    data: { liquidityRatio: liquidity ?? null },
    sources: ["liquidity-engine"],
    unavailable: liquidity == null,
  });

  // Drawdown: không có chuỗi giá từng vị thế → UNAVAILABLE trung thực
  sections.push({
    id: "drawdown",
    title: "Drawdown danh mục",
    label: "DATA-DRIVEN",
    body: "Không có chuỗi giá lịch sử của từng vị thế trong profile — hệ thống không ước lượng drawdown. Nếu có chuỗi giá trị danh mục, dùng tool max_drawdown để tính.",
    data: null,
    sources: [],
    unavailable: true,
  });

  // Risk assessment (portfolio risk), deterministic comment
  const riskSection: AgentSection = {
    id: "risk",
    title: "Rủi ro danh mục",
    label: "DATA-DRIVEN",
    body: "Đang thiếu volatility của từng vị thế (chưa khai báo) — hệ thống không ước lượng rủi ro chính xác khi thiếu dữ liệu. Hãy bổ sung hoặc dùng công cụ phân tích giá lịch sử.",
    data: null,
    sources: [],
    unavailable: true,
  };
  const riskCheck = await executeTool("portfolio_risk", {}, { profile });
  if (riskCheck.ok) {
    const r = riskCheck.data as { worstCaseVolPct: number | null; note: string };
    if (r.worstCaseVolPct != null) {
      riskSection.body = `Volatility cận trên (giả định tương quan 1 giữa các tài sản): ${pctVn(r.worstCaseVolPct, 1)}/năm. ${r.note} — đây là model inference, không phải phép đo chính xác.`;
      riskSection.unavailable = false;
    }
  }
  sections.push(riskSection);

  const narrative = sections.map((s) => `## ${s.title}\n${s.body}`).join("\n\n");
  return {
    agent: "wealth-manager",
    sections,
    narrative,
    symbols: [],
    sources: [...new Set(sections.flatMap((s) => s.sources))],
    freshness: allocation.ok ? (allocation.meta?.freshness ?? "DELAYED") : "UNAVAILABLE",
    confidence: null,
    unavailable,
    trace,
    profileUsed: true,
  };
}
