import "server-only";
import { createHash } from "crypto";
import { httpText } from "../http";
import type { NewsArticle } from "../types";
import { ProviderError } from "./binance";

/**
 * News aggregation engine — real RSS ingestion with timestamp validation,
 * deduplication, symbol/sector tagging. Cadence handled by the service cache.
 *
 * Resilience:
 *  - generous per-feed timeout + 1 retry (VN RSS often slow from edge regions)
 *  - concurrency-limited fan-out (avoid serverless connection storms)
 *  - Atom <entry> + RSS <item>
 *  - empty aggregate throws so soft-SWR keeps last good snapshot
 */

export interface FeedDef {
  name: string;
  url: string;
  category: NewsArticle["category"];
  lang: "vi" | "en";
}

export const FEEDS: FeedDef[] = [
  { name: "CafeF — Thị trường", url: "https://cafef.vn/thi-truong-chung-khoan.rss", category: "market", lang: "vi" },
  { name: "CafeF — Doanh nghiệp", url: "https://cafef.vn/doanh-nghiep.rss", category: "corporate", lang: "vi" },
  { name: "CafeF — Vĩ mô", url: "https://cafef.vn/vi-mo-dau-tu.rss", category: "macro", lang: "vi" },
  { name: "CafeF — Bất động sản", url: "https://cafef.vn/bat-dong-san.rss", category: "market", lang: "vi" },
  { name: "CafeF — Tài chính quốc tế", url: "https://cafef.vn/tai-chinh-quoc-te.rss", category: "macro", lang: "vi" },
  { name: "VnExpress — Kinh doanh", url: "https://vnexpress.net/rss/kinh-doanh.rss", category: "market", lang: "vi" },
  { name: "VietnamBiz — Tài chính", url: "https://vietnambiz.vn/rss/tai-chinh.rss", category: "market", lang: "vi" },
  { name: "VietnamBiz — Chứng khoán", url: "https://vietnambiz.vn/rss/chung-khoan.rss", category: "market", lang: "vi" },
  { name: "Tuổi Trẻ — Kinh doanh", url: "https://tuoitre.vn/rss/kinh-doanh.rss", category: "market", lang: "vi" },
  { name: "BBC Vietnamese — Business", url: "https://feeds.bbci.co.uk/vietnamese/business/rss.xml", category: "macro", lang: "vi" },
  { name: "CoinTelegraph", url: "https://cointelegraph.com/rss", category: "crypto", lang: "en" },
  {
    name: "Google News — VN-Index",
    url: "https://news.google.com/rss/search?q=VN-Index+OR+VNINDEX+OR+%22ch%E1%BB%A9ng+kho%C3%A1n%22&hl=vi&gl=VN&ceid=VN:vi",
    category: "market",
    lang: "vi",
  },
  {
    name: "Google News — NHNN",
    url: "https://news.google.com/rss/search?q=NHNN+OR+%22Ng%C3%A2n+h%C3%A0ng+Nh%C3%A0+n%C6%B0%E1%BB%9Bc%22+OR+SBV&hl=vi&gl=VN&ceid=VN:vi",
    category: "macro",
    lang: "vi",
  },
  {
    name: "Google News — Fed",
    url: "https://news.google.com/rss/search?q=Federal+Reserve+OR+Fed+interest+rate+OR+FOMC&hl=en&gl=US&ceid=US:en",
    category: "macro",
    lang: "en",
  },
];

export const NEWS_PROVIDER = "rss-news";

const FEED_TIMEOUT_MS = 10_000;
const FEED_RETRIES = 1;
const FEED_BUDGET_MS = 12_000;
const CONCURRENCY = 4;

/* ------------------------------ tagging dicts ------------------------------ */

export const VN_TICKERS = [
  "VCB","BID","CTG","TCB","MBB","VPB","ACB","STB","HDB","VIB","LPB","SHB","MSB","OCB","TPB","EIB","NAB","BAB","ABB","KLB","PGB","VBB","SGB","NVB","BVB","CBB","VAB",
  "HPG","HSG","NKG","SMC","TLH","POM","VGS","VIS","SHA","DTL","TIS","LGC","MCC","ELC","HMC","TVN","KSH","TNI","HLA","VCA","INC","KHB","CST","TMB","NTH","SBA","TDS",
  "GAS","PLX","BSR","PVD","PVS","PVT","OIL","PVC","PVE","PVB","PXS","POS","PTC","TOS","VIP","PMB","PVV","TMB","APP","ASP","BVB","CLX","DDV","DGC","DPM","DCM","CSV","BFC","NET","VAF","SFG","LAS","PCE","HSI","PGR",
  "VNM","MSN","MCH","SAB","QNS","DBC","BAF","HAG","PAN","LTG","VHC","FMC","ASM","IDI","ANV","ACL","AGX","TS4","CMX","SIP","KDC","TNG","TQT","NVL","PDR","DXG","KDH","NLG","HDG","CEO","DIG","SZC","TIP","KBC","IDC","BCM","VGC","VPH","TIX","HPP","API","FIT","CLW","CRE","HDC","NHA","SJS","TDH","LHG","QCG","HQC","IJC","SCR","LDG","DRH","FIR","CCL","DTA","AGG","TCH","HQC",
  "VIC","VHM","VRE","FPT","MWG","SSI","VND","HCM","VCI","SHS","MBS","BSI","FTS","CTS","ORS","AGR","APG","EVF","BVS","VIG","VDS","DSE","PSI","TCI","WSS","TVB","SBS","VIX","AAS","IVS","BMS","VFS",
  "GVR","PHR","DPR","TRC","RTB","VJF","HRC","DRG","DRI","CSM","MRC","VPL","BRR","DAS","BRC","SRC",
  "POW","REE","NT2","PPC","GEG","HND","QTP","SJD","VPD","TBC","CHP","VSH","BHA","RIC","SBH","HNA","VCP","TMP","AFS","TTA","S4A","DRL","TV2","SBA","GHC","PGV","HDG",
  "GMD","VSC","HAH","PVP","VTO","STG","TCL","PHP","ILB","CDN","DVP","VGR","SGP","VOS","TCO","MAS","VNL","TMS",
  "PGI","BMI","MIG","BIC","ABI","PVI","BVH","VNR","PRE","PTI","ACI","PAI","OPC","FOC","TNH","PDV","DVN","AMV","JVC","IMP","DBD","DHG","TRA","VMD","SPM","HID","CDP","PMC","PPE","TTB","DP3","MKP","NBC","HT1","BCC","BTS","YBM","QCC","HOM","KSB","VCS","VLB","DHA","CCM",
];
const VN_TICKER_SET = new Set(VN_TICKERS);

const CRYPTO_MAP: Record<string, string> = {
  bitcoin: "BTCUSDT", btc: "BTCUSDT", ethereum: "ETHUSDT", eth: "ETHUSDT", solana: "SOLUSDT", sol: "SOLUSDT",
  bnb: "BNBUSDT", xrp: "XRPUSDT", ripple: "XRPUSDT", doge: "DOGEUSDT", dogecoin: "DOGEUSDT", cardano: "ADAUSDT", ada: "ADAUSDT",
  toncoin: "TONUSDT", avax: "AVAXUSDT", avalanche: "AVAXUSDT", polkadot: "DOTUSDT", chainlink: "LINKUSDT",
};

const SECTOR_KEYWORDS: [RegExp, string][] = [
  [/ngân hàng|tín dụng|lãi suất (cho vay|huy động)|room ngoại/i, "Ngân hàng"],
  [/bất động sản|đất nền|dự án (khu|nhà ở)|chung cư/i, "Bất động sản"],
  [/thép|sắt|tôn mạ/i, "Thép"],
  [/dầu khí|giá dầu|khí đốt|xăng dầu/i, "Dầu khí"],
  [/chứng khoán|vn-?index|hose|hnx|upcom|trái phiếu/i, "Chứng khoán"],
  [/công nghệ|phần mềm|chuyển đổi số|ai\b/i, "Công nghệ"],
  [/vàng|gold|kim loại quý/i, "Kim loại quý"],
  [/cà phê|coffee|cao su|rubber|nông sản/i, "Nông sản"],
  [/điện|điện lực|evn|giá điện/i, "Điện"],
  [/bán lẻ|tiêu dùng|bán lẻ/i, "Bán lẻ"],
  [/hóa chất|phân bón|ure/i, "Hóa chất"],
  [/cao su/i, "Cao su"],
  [/fed|ecb|lạm phát|cpi|gdp|tỷ giá|đô la|usd/i, "Vĩ mô"],
];

/* --------------------------------- parsing --------------------------------- */

const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function tag(text: string): { symbols: string[]; sector: string | null } {
  const symbols = new Set<string>();
  const upper = text.toUpperCase();
  for (const t of VN_TICKER_SET) {
    if (new RegExp(`\\b${t}\\b`, "i").test(upper) && /\b[A-Z]{3}\b/.test(t)) symbols.add(t);
  }
  const lower = text.toLowerCase();
  for (const [kw, sym] of Object.entries(CRYPTO_MAP)) {
    if (new RegExp(`\\b${kw}\\b`, "i").test(lower)) symbols.add(sym);
  }
  let sector: string | null = null;
  for (const [re, name] of SECTOR_KEYWORDS) if (re.test(text)) { sector = name; break; }
  return { symbols: [...symbols].slice(0, 8), sector };
}

function extractTag(raw: string, tagName: string): string {
  const m = raw.match(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`, "i"));
  return m ? decodeXml(m[1]).trim() : "";
}

function extractLink(raw: string): string {
  const fromTag = extractTag(raw, "link");
  if (fromTag && /^https?:\/\//i.test(fromTag)) return fromTag.trim();
  const href = raw.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1];
  if (href && /^https?:\/\//i.test(href)) return href.trim();
  const selfClose = raw.match(/<link[^>]*\/>\s*([^\s<]+)/i)?.[1];
  if (selfClose && /^https?:\/\//i.test(selfClose)) return selfClose.trim();
  const guid = extractTag(raw, "guid");
  if (guid && /^https?:\/\//i.test(guid)) return guid.trim();
  return (fromTag || href || selfClose || "").trim();
}

function itemsFromXml(xml: string, feed: FeedDef): NewsArticle[] {
  const items: NewsArticle[] = [];
  const blocks =
    xml.match(/<item[\s\S]*?<\/item>/gi) ??
    xml.match(/<entry[\s\S]*?<\/entry>/gi) ??
    [];
  const now = Date.now();
  for (const raw of blocks.slice(0, 30)) {
    const title = stripTags(extractTag(raw, "title"));
    const url = extractLink(raw);
    const desc = stripTags(
      extractTag(raw, "description") ||
        extractTag(raw, "summary") ||
        extractTag(raw, "content") ||
        extractTag(raw, "content:encoded"),
    ).slice(0, 400);
    const pubRaw =
      extractTag(raw, "pubDate") ||
      extractTag(raw, "published") ||
      extractTag(raw, "updated") ||
      extractTag(raw, "date") ||
      extractTag(raw, "dc:date");
    let ts = Date.parse(pubRaw);
    if (!Number.isFinite(ts) || ts > now + 600_000 || ts < now - 30 * 86_400_000) {
      ts = now;
    }
    if (!title || !url) continue;
    const id = createHash("sha1").update(url + title).digest("hex").slice(0, 16);
    const { symbols, sector } = tag(`${title} ${desc}`);
    items.push({
      id,
      title,
      summary: desc || null,
      url,
      source: feed.name,
      category: feed.category,
      publishedAt: new Date(ts).toISOString(),
      relatedSymbols: symbols,
      relatedSector: sector,
    });
  }
  return items;
}

export async function fetchFeed(feed: FeedDef): Promise<NewsArticle[]> {
  const res = await httpText(feed.url, {
    provider: NEWS_PROVIDER,
    timeoutMs: FEED_TIMEOUT_MS,
    retries: FEED_RETRIES,
    backoffBaseMs: 400,
    headers: {
      Accept: "application/rss+xml,application/xml,text/xml,application/atom+xml,*/*",
      "Accept-Language": "vi,en;q=0.8",
    },
  });
  if (!res.ok || !res.text) {
    throw new ProviderError(`news feed ${feed.name}: ${res.error ?? "unreachable"}`, NEWS_PROVIDER);
  }
  const items = itemsFromXml(res.text, feed);
  if (!items.length) {
    throw new ProviderError(`news feed ${feed.name}: empty parse`, NEWS_PROVIDER);
  }
  return items;
}

function withFeedBudget<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("feed_budget")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Run promises with limited concurrency. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i]!) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/** Fan-out to all feeds, keep partial success, dedupe cross-feed. */
export async function aggregateNews(): Promise<{ articles: NewsArticle[]; errors: string[] }> {
  const results = await mapPool(FEEDS, CONCURRENCY, (f) =>
    withFeedBudget(fetchFeed(f), FEED_BUDGET_MS),
  );
  const seen = new Set<string>();
  const articles: NewsArticle[] = [];
  const errors: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === "rejected") {
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      continue;
    }
    for (const a of r.value) {
      const key = a.id;
      if (seen.has(key)) continue;
      seen.add(key);
      articles.push(a);
    }
  }
  articles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  if (!articles.length) {
    throw new ProviderError(
      `rss-news: all ${FEEDS.length} feeds failed (${errors.slice(0, 3).join("; ")})`,
      NEWS_PROVIDER,
    );
  }
  return { articles: articles.slice(0, 100), errors };
}
