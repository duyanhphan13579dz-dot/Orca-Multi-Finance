/**
 * Client-side report print / PDF export.
 * Builds a standalone A4 HTML document (selectable text) and opens the
 * browser print dialog — user chooses "Save as PDF". This is NOT a
 * screenshot of the app UI.
 */

import type { DailyReport } from "@/lib/services/report-engine";

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """);
}

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  } catch {
    return String(iso);
  }
}

const PRINT_CSS = `
  @page { size: A4; margin: 14mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #0c1a33;
    margin: 0;
    padding: 0;
    line-height: 1.55;
    font-size: 11.5px;
    background: #fff;
  }
  .wrap { max-width: 180mm; margin: 0 auto; }
  .hd {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    border-bottom: 3px solid #123f7c;
    padding-bottom: 12px;
    margin-bottom: 12px;
  }
  .logo {
    width: 40px; height: 40px;
    border-radius: 8px;
    object-fit: contain;
    border: 1px solid #ccd;
    background: #fff;
    flex-shrink: 0;
  }
  .hd h1 { font-size: 16px; margin: 0; color: #0c1a33; line-height: 1.3; }
  .hd .sub { margin: 3px 0 0; color: #5a6b8c; font-size: 10.5px; }
  .badge {
    margin-left: auto;
    border: 1px solid #ccd;
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 9px;
    color: #134078;
    font-weight: 700;
    letter-spacing: 0.12em;
    white-space: nowrap;
    align-self: center;
  }
  .meta {
    font-size: 10px;
    color: #5a6b8c;
    margin-bottom: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
  }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 12px; }
  .tag {
    font-size: 9px;
    border: 1px solid #d0d7e2;
    border-radius: 4px;
    padding: 2px 6px;
    color: #334;
    background: #f4f7fb;
  }
  h2 {
    font-size: 12px;
    color: #123f7c;
    margin: 14px 0 5px;
    border-left: 3px solid #123f7c;
    padding-left: 8px;
    page-break-after: avoid;
  }
  h2.up { color: #0a7a3e; border-left-color: #0a7a3e; }
  h2.down { color: #b42318; border-left-color: #b42318; }
  p { margin: 3px 0; font-size: 11px; color: #1a2a40; }
  .section { page-break-inside: avoid; margin-bottom: 4px; }
  .scenarios {
    display: table;
    width: 100%;
    border-collapse: collapse;
    margin: 8px 0 4px;
  }
  .scenarios > div {
    display: table-cell;
    width: 33.33%;
    vertical-align: top;
    border: 1px solid #ccd;
    padding: 8px;
  }
  .scenarios b { display: block; font-size: 11px; margin-bottom: 2px; }
  .scenarios .prob { font-size: 9.5px; color: #5a6b8c; }
  .scenarios p { font-size: 10px; margin: 4px 0 0; color: #334; }
  .foot {
    margin-top: 16px;
    text-align: center;
    font-size: 9px;
    color: #8a97ab;
  }
  @media print {
    body { margin: 0; }
    .no-print { display: none !important; }
  }
`;

/**
 * Open a print-ready A4 document for a daily report and trigger print dialog.
 * User can choose "Save as PDF" for a real text PDF (not a UI screenshot).
 */
export function printDailyReport(report: DailyReport): void {
  const when = fmtWhen(report.generatedAt);
  const dataUntil = fmtWhen(report.marketDataTimestamp);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const logoSrc = `${origin}/brand/orca-mark.svg`;

  const sectionsHtml = (report.sections ?? [])
    .map((s) => {
      const toneClass = s.tone === "up" ? "up" : s.tone === "down" ? "down" : "";
      const paras = (s.paragraphs ?? [])
        .map((p) => `<p>${esc(p)}</p>`)
        .join("");
      return `<div class="section"><h2 class="${toneClass}">${esc(s.heading)}</h2>${paras}</div>`;
    })
    .join("");

  const scenariosHtml =
    report.scenarios?.length > 0
      ? `<h2>Kịch bản Base / Bull / Bear</h2>
         <div class="scenarios">${report.scenarios
           .map(
             (sc) =>
               `<div><b>${esc(sc.label)}</b><span class="prob">${esc(sc.probabilityRange)}</span>
                <p>${esc(sc.drivers)}</p>
                <p style="color:#5a6b8c">${esc(sc.indexZones)}</p></div>`,
           )
           .join("")}</div>`
      : "";

  const freshnessTags = Object.entries(report.freshness ?? {})
    .map(([k, v]) => `<span class="tag">${esc(k)}: ${esc(String(v))}</span>`)
    .join("");

  const body = `
  <div class="wrap">
    <div class="hd">
      <img class="logo" src="${esc(logoSrc)}" alt="ORCA" width="40" height="40" onerror="this.style.display='none'" />
      <div style="flex:1;min-width:0">
        <h1>${esc(report.title)}</h1>
        <p class="sub">${esc(report.subtitle)}</p>
      </div>
      <span class="badge">ORCA RESEARCH</span>
    </div>
    <div class="meta">
      <span>Phát hành: ${esc(when)}</span>
      ${report.marketDataTimestamp ? `<span>· Dữ liệu đến: ${esc(dataUntil)}</span>` : ""}
      <span>· ${esc(report.type.replace(/_/g, " "))}</span>
    </div>
    ${freshnessTags ? `<div class="tags">${freshnessTags}</div>` : ""}
    ${sectionsHtml}
    ${scenariosHtml}
    <div class="foot">ORCA Financial — Generated from verified market data · không phải khuyến nghị đầu tư</div>
  </div>`;

  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    alert("Trình duyệt chặn cửa sổ xuất PDF. Cho phép popup rồi thử lại.");
    return;
  }

  w.document.write(`<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <title>${esc(report.title)}</title>
  <style>${PRINT_CSS}</style>
</head>
<body>${body}
<script>
  window.onload = function () {
    setTimeout(function () {
      window.focus();
      window.print();
    }, 280);
  };
</script>
</body>
</html>`);
  w.document.close();
}
