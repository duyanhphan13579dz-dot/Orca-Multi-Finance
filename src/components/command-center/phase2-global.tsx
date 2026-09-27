"use client";

import { useMemo } from "react";
import type { MarketIntel } from "@/lib/services/market-intel";
import { fmtCompact, fmtNum } from "@/components/ui";

function pct(p: number | null | undefined, digits = 2): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p > 0 ? "+" : ""}${p.toFixed(digits)}%`;
}

function tonePct(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return "text-text-muted";
  if (p > 0.05) return "text-up";
  if (p < -0.05) return "text-down";
  return "text-text-secondary";
}

/* ===================== Phase 2: Global layer ===================== */

export type GlobalUsRow = { symbol: string; price: number; changePercent: number | null };
export type GlobalCryptoRow = {
  symbol: string;
  baseAsset: string;
  price: number;
  changePercent: number | null;
};

function pickCross(items: MarketIntel["crossAsset"], key: string) {
  return items.find((x) => x.key === key) ?? null;
}

function regimeLabel(chgs: (number | null | undefined)[]): string {
  const vals = chgs.filter((x): x is number => x != null && Number.isFinite(x));
  if (!vals.length) return "—";
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (avg >= 0.25) return "RISK-ON";
  if (avg <= -0.25) return "RISK-OFF";
  return "MIXED";
}

function regimeTone(label: string): string {
  if (label === "RISK-ON") return "text-up";
  if (label === "RISK-OFF") return "text-down";
  return "text-amber-300";
}

export function GlobalMarketRegime({
  intel,
  us,
  crypto,
}: {
  intel: MarketIntel;
  us: GlobalUsRow[];
  crypto: GlobalCryptoRow[];
}) {
  const dxy = pickCross(intel.crossAsset, "DXY");
  const wti = pickCross(intel.crossAsset, "WTI");
  const gold = pickCross(intel.crossAsset, "GOLD");
  const btcCa = pickCross(intel.crossAsset, "BTC");

  const spy = us.find((x) => x.symbol === "SPY");
  const qqq = us.find((x) => x.symbol === "QQQ");
  const dia = us.find((x) => x.symbol === "DIA");

  const btc =
    crypto.find((x) => x.baseAsset === "BTC" || x.symbol.startsWith("BTC")) ??
    (btcCa
      ? { symbol: "BTC", baseAsset: "BTC", price: btcCa.value ?? 0, changePercent: btcCa.changePercent }
      : null);
  const eth = crypto.find((x) => x.baseAsset === "ETH" || x.symbol.startsWith("ETH"));

  const usLabel = regimeLabel([spy?.changePercent, qqq?.changePercent, dia?.changePercent]);
  const fxLabel = regimeLabel([
    dxy?.changePercent != null ? -dxy.changePercent : null,
    wti?.changePercent,
    gold?.changePercent != null ? -gold.changePercent * 0.5 : null,
  ]);
  const cryptoLabel = regimeLabel([btc?.changePercent, eth?.changePercent]);

  const regions: {
    title: string;
    tag: string;
    rows: { name: string; value: string; chg: number | null }[];
  }[] = [
    {
      title: "MỸ",
      tag: usLabel,
      rows: [
        { name: "S&P 500 (SPY)", value: spy ? fmtNum(spy.price, 2) : "—", chg: spy?.changePercent ?? null },
        { name: "NASDAQ (QQQ)", value: qqq ? fmtNum(qqq.price, 2) : "—", chg: qqq?.changePercent ?? null },
        { name: "Dow (DIA)", value: dia ? fmtNum(dia.price, 2) : "—", chg: dia?.changePercent ?? null },
      ],
    },
    {
      title: "FX & HÀNG HÓA",
      tag: fxLabel,
      rows: [
        { name: "DXY", value: dxy?.value != null ? fmtNum(dxy.value, 2) : "—", chg: dxy?.changePercent ?? null },
        { name: "WTI", value: wti?.value != null ? fmtNum(wti.value, 2) : "—", chg: wti?.changePercent ?? null },
        { name: "Gold", value: gold?.value != null ? fmtNum(gold.value, 2) : "—", chg: gold?.changePercent ?? null },
      ],
    },
    {
      title: "CRYPTO",
      tag: cryptoLabel,
      rows: [
        { name: "BTC", value: btc?.price ? fmtNum(btc.price, 0) : "—", chg: btc?.changePercent ?? null },
        { name: "ETH", value: eth?.price ? fmtNum(eth.price, 0) : "—", chg: eth?.changePercent ?? null },
        { name: "Cross-asset", value: intel.condition.crossAssetState, chg: null },
      ],
    },
    {
      title: "VIỆT NAM",
      tag: regimeLabel((intel.indices ?? []).slice(0, 2).map((i) => i.changePercent)),
      rows: (intel.indices ?? []).slice(0, 3).map((i) => ({
        name: i.code,
        value: fmtNum(i.value, 2),
        chg: i.changePercent ?? null,
      })),
    },
  ];

  return (
    <section className="cc-panel">
      <div className="cc-panel-head">
        <h2>GLOBAL MARKET REGIME</h2>
        <div className="flex gap-3 text-[10px] text-text-muted">
          <span className="text-up">● Risk-on</span>
          <span>● Mixed</span>
          <span className="text-down">● Risk-off</span>
        </div>
      </div>
      <div className="grid gap-2 p-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {regions.map((r) => (
          <div key={r.title} className="rounded-md border border-border-subtle/80 bg-surface-base/40 p-2.5">
            <div className="mb-1.5 flex items-center justify-between border-b border-border-subtle/50 pb-1">
              <b className="text-[11px] font-bold tracking-wide text-text-primary">{r.title}</b>
              <span className={`text-[10px] font-semibold ${regimeTone(r.tag)}`}>{r.tag}</span>
            </div>
            <div className="space-y-1">
              {r.rows.map((row) => (
                <div
                  key={row.name}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-[11px] text-text-muted"
                >
                  <span className="truncate">{row.name}</span>
                  <b className="num text-text-secondary">{row.value}</b>
                  <em className={`num not-italic font-semibold ${tonePct(row.chg)}`}>
                    {row.chg != null ? pct(row.chg) : "—"}
                  </em>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

type ImpactVerdict = "HỖ TRỢ" | "TRUNG TÍNH" | "ÁP LỰ" | "PHÂN HÓA";

function verdictFromChg(chg: number | null | undefined, invert = false): ImpactVerdict {
  if (chg == null || !Number.isFinite(chg)) return "TRUNG TÍNH";
  const v = invert ? -chg : chg;
  if (v >= 0.2) return "HỖ TRỢ";
  if (v <= -0.2) return "ÁP LỰ";
  return "TRUNG TÍNH";
}

function verdictCls(v: ImpactVerdict): string {
  if (v === "HỖ TRỢ") return "text-up";
  if (v === "ÁP LỰ") return "text-down";
  if (v === "PHÂN HÓA") return "text-orange-300";
  return "text-amber-300";
}

export function GlobalImpactMap({ intel }: { intel: MarketIntel }) {
  const dxy = pickCross(intel.crossAsset, "DXY");
  const wti = pickCross(intel.crossAsset, "WTI");
  const gold = pickCross(intel.crossAsset, "GOLD");
  const usdvnd = pickCross(intel.crossAsset, "USDVND");
  const vnChg = intel.indices?.[0]?.changePercent ?? null;
  const flow = intel.flow.foreignNet;

  const flows = [
    {
      name: "US risk (proxy)",
      chg:
        intel.condition.crossAssetState === "RISK ON"
          ? 0.4
          : intel.condition.crossAssetState === "RISK OFF"
            ? -0.4
            : 0,
    },
    { name: "DXY", chg: dxy?.changePercent ?? null },
    { name: "WTI", chg: wti?.changePercent ?? null },
    { name: "Gold", chg: gold?.changePercent ?? null },
    { name: "USD/VND", chg: usdvnd?.changePercent ?? null },
  ];

  const cards: { label: string; value: string; verdict: ImpactVerdict }[] = [
    {
      label: "USD/VND",
      value:
        usdvnd?.changePercent != null && Math.abs(usdvnd.changePercent) < 0.15
          ? "Ổn định"
          : usdvnd?.changePercent != null && usdvnd.changePercent > 0
            ? "VND yếu"
            : "VND mạnh / ổn",
      verdict: verdictFromChg(usdvnd?.changePercent, true),
    },
    {
      label: "Hàng hóa",
      value: wti?.changePercent != null && wti.changePercent > 0.3 ? "Dầu tăng — phân hóa" : "Trung tính / nhẹ",
      verdict: wti?.changePercent != null && Math.abs(wti.changePercent) > 0.3 ? "PHÂN HÓA" : "TRUNG TÍNH",
    },
    {
      label: "Dòng ngoại",
      value: flow != null ? `${flow >= 0 ? "+" : ""}${fmtCompact(flow)}` : "—",
      verdict: flow != null ? (flow >= 0 ? "HỖ TRỢ" : "ÁP LỰ") : "TRUNG TÍNH",
    },
    {
      label: "Risk appetite",
      value: intel.condition.crossAssetState,
      verdict:
        intel.condition.crossAssetState === "RISK ON"
          ? "HỖ TRỢ"
          : intel.condition.crossAssetState === "RISK OFF"
            ? "ÁP LỰ"
            : "TRUNG TÍNH",
    },
  ];

  return (
    <article className="cc-panel">
      <div className="cc-panel-head">
        <h2>GLOBAL → VIETNAM IMPACT</h2>
        <span className="cc-tag border-cyan-500/40 bg-cyan-500/10 text-cyan-300">LIVE MAP</span>
      </div>
      <div className="grid items-center gap-3 px-3 py-3 md:grid-cols-[7rem_1fr_7rem]">
        <div className="flex flex-col items-center justify-center rounded-md border border-border-subtle bg-surface-base/50 px-2 py-3 text-center">
          <span className="text-lg font-bold text-accent-primary">◎</span>
          <b className="mt-1 text-[10px] tracking-wide">QUỐC TẾ</b>
          <small className="text-[10px] text-text-muted">{intel.condition.crossAssetState}</small>
        </div>
        <div className="space-y-1.5">
          {flows.map((f) => (
            <div
              key={f.name}
              className="grid grid-cols-[6.5rem_3.5rem_1fr] items-center gap-2 text-[11px] text-text-muted"
            >
              <span>{f.name}</span>
              <b className={`num ${tonePct(f.chg)}`}>{f.chg != null ? pct(f.chg) : "—"}</b>
              <span className="h-0.5 rounded-full bg-gradient-to-r from-border-subtle to-accent-primary/40" />
            </div>
          ))}
        </div>
        <div className="flex flex-col items-center justify-center rounded-md border border-border-subtle bg-surface-base/50 px-2 py-3 text-center">
          <span className="text-sm font-bold text-up">VN</span>
          <b className="mt-1 text-[10px] tracking-wide">VIỆT NAM</b>
          <small className={`text-[10px] ${tonePct(vnChg)}`}>
            {intel.indices?.[0]?.code ?? "VN-Index"} {vnChg != null ? pct(vnChg) : "—"}
          </small>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-1.5 px-3 pb-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-md border border-border-subtle/70 bg-surface-base/40 px-2 py-1.5">
            <span className="block text-[9px] uppercase tracking-wide text-text-muted">{c.label}</span>
            <div className="mt-0.5 flex items-center justify-between gap-1">
              <strong className="text-[11px] text-text-primary">{c.value}</strong>
              <span className={`text-[10px] font-bold ${verdictCls(c.verdict)}`}>
                {c.verdict === "HỖ TRỢ" ? "+" : c.verdict === "ÁP LỰ" ? "−" : "→"}
              </span>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}

type Channel = {
  title: string;
  verdict: ImpactVerdict;
  body: string;
  tags: string[];
};

function buildTransmission(intel: MarketIntel): Channel[] {
  const dxy = pickCross(intel.crossAsset, "DXY");
  const wti = pickCross(intel.crossAsset, "WTI");
  const gold = pickCross(intel.crossAsset, "GOLD");
  const state = intel.condition.crossAssetState;

  const dxyChg = dxy?.changePercent ?? null;
  const dxyV = verdictFromChg(dxyChg, true);
  const wtiChg = wti?.changePercent ?? null;
  const wtiV: ImpactVerdict = wtiChg != null && Math.abs(wtiChg) >= 0.35 ? "PHÂN HÓA" : "TRUNG TÍNH";
  const riskV: ImpactVerdict =
    state === "RISK ON" ? "HỖ TRỢ" : state === "RISK OFF" ? "ÁP LỰ" : "TRUNG TÍNH";
  const goldV = verdictFromChg(gold?.changePercent, true);

  return [
    {
      title: dxyChg != null ? `DXY ${pct(dxyChg)}` : "DXY",
      verdict: dxyV,
      body:
        dxyV === "HỖ TRỢ"
          ? "USD yếu hơn có thể giảm áp lực tỷ giá và tạo dư địa thuận lợi hơn cho tài sản rủi ro tại Việt Nam."
          : dxyV === "ÁP LỰ"
            ? "USD mạnh hơn có thể gia tăng áp lực tỷ giá và rút bớt khẩu vị rủi ro với thị trường mới nổi."
            : "USD đi ngang — tác động tỷ giá và dòng vốn qua kênh DXY chưa rõ ràng.",
      tags: ["VN-Index", "Ngân hàng", "Midcap"],
    },
    {
      title: gold?.changePercent != null ? `GOLD ${pct(gold.changePercent)}` : "GOLD / RISK",
      verdict: goldV,
      body:
        goldV === "ÁP LỰ"
          ? "Vàng tăng mạnh thường đi kèm risk-off — cần theo dõi liệu dòng tiền có tránh tài sản rủi ro khu vực."
          : goldV === "HỖ TRỢ"
            ? "Vàng dịu bớt có thể phản ánh khẩu vị rủi ro ổn định hơn trên toàn cầu."
            : "Vàng biến động nhẹ — tín hiệu risk chưa đủ mạnh để định hướng VN.",
      tags: ["Foreign Flow", "FX", "Bluechip"],
    },
    {
      title: wtiChg != null ? `WTI ${pct(wtiChg)}` : "WTI",
      verdict: wtiV,
      body:
        wtiChg != null && wtiChg > 0.35
          ? "Giá dầu tăng hỗ trợ nhóm dầu khí nhưng có thể gây áp lực chi phí vận tải và lạm phát đầu vào."
          : wtiChg != null && wtiChg < -0.35
            ? "Dầu giảm có thể hỗ trợ biên lợi nhuận hạ nguồn, đồng thời làm yếu nhóm dầu khí."
            : "Giá dầu ổn định — tác động ngành chưa tạo phân hóa lớn.",
      tags: ["Dầu khí", "Vận tải", "Hóa chất"],
    },
    {
      title: `GLOBAL RISK · ${state}`,
      verdict: riskV,
      body:
        riskV === "HỖ TRỢ"
          ? "Tâm lý risk-on quốc tế tạo nền thuận lợi; cần xác nhận bằng dòng tiền và độ rộng trong nước."
          : riskV === "ÁP LỰ"
            ? "Risk-off toàn cầu có thể làm giảm khẩu vị với thị trường mới nổi, kể cả khi nội tại VN chưa xấu."
            : "Khẩu vị rủi ro toàn cầu trung tính — yếu tố nội địa (breadth, flow) sẽ quyết định nhịp gần.",
      tags: ["VN30", "Foreign Flow", "Bluechip"],
    },
  ];
}

export function TransmissionPanel({ intel }: { intel: MarketIntel }) {
  const channels = useMemo(() => buildTransmission(intel), [intel]);

  return (
    <section className="cc-panel">
      <div className="cc-panel-head">
        <h2>QUỐC TẾ ẢNH HƯỞNG VIỆT NAM NHƯ THẾ NÀO?</h2>
        <span className="text-[10px] text-text-muted">ORCA TRANSMISSION · rule-based</span>
      </div>
      <div className="grid gap-2 p-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {channels.map((ch) => (
          <div key={ch.title} className="rounded-md border border-border-subtle/80 bg-surface-base/40 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <b className="text-[12px] text-text-primary">{ch.title}</b>
              <span className={`text-[10px] font-bold ${verdictCls(ch.verdict)}`}>{ch.verdict}</span>
            </div>
            <p className="mt-1.5 min-h-[3.2rem] text-[11px] leading-snug text-text-muted">{ch.body}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {ch.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded border border-border-subtle px-1.5 py-0.5 text-[9px] text-text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
