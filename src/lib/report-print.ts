/**
 * Client-side report print / PDF export.
 * Builds a standalone A4 HTML document (selectable text) and opens the
 * browser print dialog — user chooses "Save as PDF". This is NOT a
 * screenshot of the app UI.
 */

import type { DailyReport } from "@/lib/services/report-engine";
import { cleanHeading, sectionToLines } from "@/lib/report-format";

/** Escape for HTML text/attrs without embedding literal entity sequences in source. */
function esc(s: string): string {
  const amp = String.fromCharCode(38) + "amp;";
  const lt = String.fromCharCode(38) + "lt;";
  const gt = String.fromCharCode(38) + "gt;";
  const quot = String.fromCharCode(38) + "quot;";
  return String(s ?? "")
    .replace(/&/g, amp)
    .replace(/</g, lt)
    .replace(/>/g, gt)
    .replace(/"/g, quot);
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
    line-height: 1.65;
    letter-spacing: 0.01em;
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
  .hd h1 { font-size: 16px; margin: 0; color: #0c1a33; line-height: 1.35; letter-spacing: -0.01em; }
  .hd .sub { margin: 4px 0 0; color: #5a6b8c; font-size: 10.5px; line-height: 1.5; }
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
    line-height: 1.5;
  }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px; }
  .tag {
    font-size: 9px;
    border: 1px solid #d0d7e2;
    border-radius: 4px;
    padding: 2px 6px;
    color: #334;
    background: #f4f7fb;
  }
  .chip {
    border: 1px solid #d8dee8;
    border-left: 3px solid #123f7c;
    border-radius: 10px;
    background: #f7f9fc;
    padding: 10px 12px 11px;
    margin: 0 0 10px;
    page-break-inside: avoid;
  }
  .chip.up { border-left-color: #0a7a3e; }
  .chip.down { border-left-color: #b42318; }
  .chip h2 {
    font-size: 12px;
    color: #123f7c;
    margin: 0 0 6px;
    line-height: 1.35;
    letter-spacing: -0.01em;
  }
  .chip.up h2 { color: #0a7a3e; }
  .chip.down h2 { color: #b42318; }
  .chip p {
    margin: 0 0 5px;
    font-size: 11px;
    color: #1a2a40;
    line-height: 1.65;
  }
  .chip p:last-child { margin-bottom: 0; }
  .chip ul {
    margin: 4px 0 0;
    padding: 0;
    list-style: none;
  }
  .chip li {
    position: relative;
    padding-left: 12px;
    margin: 0 0 4px;
    font-size: 11px;
    color: #1a2a40;
    line-height: 1.65;
  }
  .chip li::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0.55em;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: #123f7c;
  }
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

function linesToHtml(paragraphs: string[]): string {
  const lines = sectionToLines(paragraphs);
  if (!lines.length) return "";
  const bullets = lines.filter((l) => l.kind === "bullet");
  const prose = lines.filter((l) => l.kind === "prose");
  const mostlyBullets = bullets.length >= Math.max(1, prose.length);

  const proseHtml = prose.map((l) => `<p>${esc(l.text)}</p>`).join("");
  const bulletHtml =
    bullets.length > 0
      ? `<ul>${bullets.map((l) => `<li>${esc(l.text)}</li>`).join("")}</ul>`
      : "";

  if (mostlyBullets) return proseHtml + bulletHtml;

  return lines
    .map((l) =>
      l.kind === "bullet" ? `<ul><li>${esc(l.text)}</li></ul>` : `<p>${esc(l.text)}</p>`,
    )
    .join("");
}

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
      const heading = cleanHeading(s.heading);
      const body = linesToHtml(s.paragraphs ?? []);
      return `<div class="chip ${toneClass}"><h2>${esc(heading)}</h2>${body}</div>`;
    })
    .join("");

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
