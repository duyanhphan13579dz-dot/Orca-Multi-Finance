import "server-only";
import { SSC_BASE, SSC_NEWS_PATH } from "./adf-client";
import { env } from "../../env";
import { rowsToFilings, type SscScrapedRow } from "./ssc-scrape";
import type { OfficialFiling } from "./types";

/**
 * Optional Playwright worker for full SSC coverage.
 * Enable: SSC_HEADLESS=1 and `npm i playwright && npx playwright install chromium`
 */

export interface HeadlessScrapeResult {
  available: boolean;
  ok: boolean;
  rows: SscScrapedRow[];
  filings: OfficialFiling[];
  pdfs: { rowIndex: number; fileName: string; size: number; contentType: string }[];
  notes: string[];
  latencyMs: number;
}

interface PlaywrightPage {
  goto: (url: string, opts?: object) => Promise<unknown>;
  waitForSelector: (sel: string, opts?: object) => Promise<unknown>;
  fill: (sel: string, val: string) => Promise<void>;
  click: (sel: string, opts?: object) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
  content: () => Promise<string>;
  on: (event: string, handler: (payload: unknown) => void) => void;
  close: () => Promise<void>;
}

interface PlaywrightBrowser {
  newPage: () => Promise<PlaywrightPage>;
  close: () => Promise<void>;
}

interface PlaywrightModule {
  chromium: {
    launch: (opts?: object) => Promise<PlaywrightBrowser>;
  };
}

function headlessEnabled(): boolean {
  return env.sscHeadless;
}

async function loadPlaywright(): Promise<PlaywrightModule | null> {
  try {
    const pw = await import(/* webpackIgnore: true */ "playwright" as string);
    return pw as unknown as PlaywrightModule;
  } catch {
    return null;
  }
}

function parseRowsFromHtml(html: string): SscScrapedRow[] {
  const idxs = new Set<number>();
  for (const m of html.matchAll(/id="pt9:t1:(\d+):c/g)) idxs.add(Number(m[1]));
  const rows: SscScrapedRow[] = [];
  const read = (source: string, row: number, col: string): string => {
    const marker = `id="pt9:t1:${row}:c${col}"`;
    const start = source.indexOf(marker);
    if (start < 0) return "";
    const gt = source.indexOf(">", start);
    const end = source.indexOf("</td>", gt);
    if (gt < 0 || end < 0) return "";
    return source
      .slice(gt + 1, end)
      .replace(/<[^>]+>/g, " ")
      .replace(/&/g, "&")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, " ")
      .trim();
  };
  for (const i of [...idxs].sort((a, b) => a - b)) {
    const ticker = read(html, i, "5");
    const reportName = read(html, i, "3");
    if (!reportName && !ticker) continue;
    rows.push({
      stt: read(html, i, "12"),
      floor: read(html, i, "2"),
      ticker: ticker.toUpperCase(),
      reportName,
      company: read(html, i, "8"),
      summary: read(html, i, "111"),
      submittedAt: read(html, i, "7"),
      rowIndex: i,
    });
  }
  return rows;
}

export async function headlessScrapeSsc(
  symbol: string,
  opts?: { downloadPdf?: boolean; maxPdfs?: number },
): Promise<HeadlessScrapeResult> {
  const t0 = performance.now();
  const notes: string[] = [];
  const sym = symbol.toUpperCase();

  if (!headlessEnabled()) {
    return {
      available: false,
      ok: false,
      rows: [],
      filings: [],
      pdfs: [],
      notes: ["SSC_HEADLESS not enabled — set SSC_HEADLESS=1 and install playwright"],
      latencyMs: 0,
    };
  }

  const pw = await loadPlaywright();
  if (!pw) {
    return {
      available: false,
      ok: false,
      rows: [],
      filings: [],
      pdfs: [],
      notes: ["playwright package not installed — run: npm i playwright && npx playwright install chromium"],
      latencyMs: 0,
    };
  }

  let browser: PlaywrightBrowser | null = null;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();

    const url = `${SSC_BASE}${SSC_NEWS_PATH}`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    notes.push("navigated NewsSearch");

    try {
      await page.waitForSelector('#pt9\\:it8112\\:\\:content, input[id*="it8112"]', { timeout: 20_000 });
    } catch {
      notes.push("search input not found — waiting for table");
      await page.waitForTimeout(3000);
    }

    const inputSelectors = [
      '#pt9\\:it8112\\:\\:content',
      'input[id*="it8112"]',
      'input[name="pt9:it8112"]',
    ];
    let filled = false;
    for (const sel of inputSelectors) {
      try {
        await page.fill(sel, sym);
        filled = true;
        notes.push(`filled MCK via ${sel}`);
        break;
      } catch {
        /* try next */
      }
    }
    if (!filled) notes.push("could not fill MCK input");

    const btnSelectors = ['#pt9\\:b1', 'a[id="pt9:b1"]', "text=Tìm kiếm"];
    for (const sel of btnSelectors) {
      try {
        await page.click(sel, { timeout: 5_000 });
        notes.push(`clicked search ${sel}`);
        break;
      } catch {
        /* next */
      }
    }

    await page.waitForTimeout(2500);
    const html = await page.content();
    let rows = parseRowsFromHtml(html).filter((r) => !r.ticker || r.ticker === sym);
    if (!rows.length) {
      rows = parseRowsFromHtml(html).filter((r) => r.ticker === sym);
    }
    notes.push(`headless parsed ${rows.length} rows for ${sym}`);

    const pdfs: HeadlessScrapeResult["pdfs"] = [];
    if (opts?.downloadPdf && rows.length) {
      const max = opts.maxPdfs ?? 1;
      for (let i = 0; i < Math.min(max, rows.length); i++) {
        const row = rows[i];
        try {
          const downloadPromise = new Promise<{
            suggestedFilename: () => string;
          }>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("download_timeout")), 15_000);
            page.on("download", (d) => {
              clearTimeout(timer);
              resolve(d as { suggestedFilename: () => string });
            });
          });
          await page
            .click(`#pt9\\:t1\\:${row.rowIndex}\\:cil4z`, { timeout: 8_000 })
            .catch(() => page.click(`a[id="pt9:t1:${row.rowIndex}:cil4z"]`, { timeout: 5_000 }));
          const download = await downloadPromise;
          const fileName = download.suggestedFilename();
          notes.push(`download started: ${fileName}`);
          pdfs.push({
            rowIndex: row.rowIndex,
            fileName,
            size: 0,
            contentType: fileName.toLowerCase().endsWith(".pdf")
              ? "application/pdf"
              : "application/octet-stream",
          });
        } catch (e) {
          notes.push(`pdf row ${row.rowIndex}: ${e instanceof Error ? e.message.slice(0, 80) : "fail"}`);
        }
      }
    }

    await page.close();
    const filings = rowsToFilings(rows, sym);
    return {
      available: true,
      ok: rows.length > 0 || filings.length > 0,
      rows,
      filings,
      pdfs,
      notes,
      latencyMs: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return {
      available: true,
      ok: false,
      rows: [],
      filings: [],
      pdfs: [],
      notes: [e instanceof Error ? e.message.slice(0, 200) : "headless_error"],
      latencyMs: Math.round(performance.now() - t0),
    };
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }
}
