import "server-only";
import { createHash } from "crypto";
import { httpText } from "../http";
import type { NewsArticle } from "../types";

/**
 * Multi-source RSS news provider (public, free, no API key).
 *
 * Design notes:
 *  - parallel fetch with concurrency limit (avoid serverless connection storm)
 *  - per-feed circuit breaker name so one dead feed does not open global circuit
 *  - generous per-feed timeout + 1 retry (VN RSS often slow from edge regions)
 *  - hard budget deadline so one hung feed cannot block the whole page
 *  - throw on total empty so soft-SWR cache is not poisoned with []
 *  - Atom + RSS support, resilient link extraction
 */

export type FeedDef = {
  name: string;
  url: string;
  category: string;
  lang: "vi" | "en";
};

export const FEEDS: FeedDef[] = [
  {
    name: "cafef",
    url: "https://cafef.vn/thi-truong-chung-khoan.rss",
    category: "market",
    lang: "vi",
  },
  {
    name: "vnexpress-kinhdoanh",
    url: "https://vnexpress.net/rss/kinh-doanh.rss",
    category: "market",
    lang: "vi",
  },
  {
    name: "vietstock",
    url: "https://vietstock.vn/rss/thi-truong.rss",
    category: "market",
    lang: "vi",
  },
  {
    name: "ndh",
    url: "https://ndh.vn/rss/thi-truong",
    category: "market",
    lang: "vi",
  },
  {
    name: "tinnhanhchungkhoan",
    url: "https://www.tinnhanhchungkhoan.vn/rss/chung-khoan.rss",
    category: "market",
    lang: "vi",
  },
  {
    name: "tuoitre-kinhdoanh",
    url: "https://tuoitre.vn/rss/kinh-doanh.rss",
    category: "market",
    lang: "vi",
  },
  {
    name: "bbc-business",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
    category: "macro",
    lang: "en",
  },
  {
    name: "reuters-business",
    url: "https://www.reutersagency.com/feed/?best-topics=business-finance&post_type=best",
    category: "macro",
    lang: "en",
  },
  {
    name: "google-news-vn",
    url: "https://news.google.com/rss/search?q=chứng+khoán+OR+VN-Index+OR+HOSE&hl=vi&gl=VN&ceid=VN:vi",
    category: "market",
    lang: "vi",
  },
  {
    name: "google-news-crypto",
    url: "https://news.google.com/rss/search?q=bitcoin+OR+crypto+OR+ethereum&hl=en&gl=US&ceid=US:en",
    category: "crypto",
    lang: "en",
  },
  {
    name: "google-news-macro",
    url: "https://news.google.com/rss/search?q=Federal+Reserve+OR+Fed+interest+rate+OR+FOMC&hl=en&gl=US&ceid=US:en",
    category: "macro",
    lang: "en",
  },
  {
    name: "cointelegraph",
    url: "https://cointelegraph.com/rss",
    category: "crypto",
    lang: "en",
  },
];

export const NEWS_PROVIDER = "rss-news";

const FEED_TIMEOUT_MS = 14_000;
const FEED_RETRIES = 1;
const FEED_BUDGET_MS = 18_000;
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

/* ------------------------------ XML helpers ------------------------------ */

function decodeXml(s: string): string {
  return s
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/&/g, "&")
    .replace(/"/g, '"')
    .replace(/'/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function stripTags(s: string): string {
  return decodeXml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? stripTags(m[1]) : null;
}

function extractLink(block: string): string | null {
  // <link>url</link> or <link href="url" /> (Atom)
  const plain = extractTag(block, "link");
  if (plain && /^https?:\/\//i.test(plain)) return plain;
  const href = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (href) return href[1];
  const guid = extractTag(block, "guid");
  if (guid && /^https?:\/\//i.test(guid)) return guid;
  return null;
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[0]);
  return items;
}

function parsePublished(block: string): string | null {
  for (const tag of ["pubDate", "published", "updated", "dc:date"]) {
    const v = extractTag(block, tag);
    if (v) {
      const t = Date.parse(v);
      if (Number.isFinite(t)) return new Date(t).toISOString();
    }
  }
  return null;
}

function tagArticle(title: string, summary: string): { tickers: string[]; sectors: string[]; symbols: string[] } {
  const text = `${title} ${summary}`;
  const tickers: string[] = [];
  for (const t of VN_TICKER_SET) {
    if (new RegExp(`\\b${t}\\b`, "i").test(text)) tickers.push(t);
  }
  const sectors: string[] = [];
  for (const [re, name] of SECTOR_KEYWORDS) {
    if (re.test(text)) sectors.push(name);
  }
  const symbols: string[] = [];
  for (const [k, v] of Object.entries(CRYPTO_MAP)) {
    if (new RegExp(`\\b${k}\\b`, "i").test(text)) symbols.push(v);
  }
  return { tickers: [...new Set(tickers)], sectors: [...new Set(sectors)], symbols: [...new Set(symbols)] };
}

function articleId(url: string, title: string): string {
  return createHash("sha1").update(`${url}|${title}`).digest("hex").slice(0, 16);
}

/* ------------------------------ fetch + parse ------------------------------ */

async function fetchFeed(feed: FeedDef): Promise<{ articles: NewsArticle[]; error?: string }> {
  const res = await httpText(feed.url, {
    provider: `news:${feed.name}`,
    timeoutMs: FEED_TIMEOUT_MS,
    retries: FEED_RETRIES,
    backoffBaseMs: 400,
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
    },
  });
  if (!res.ok || !res.text) {
    return { articles: [], error: res.error ?? `http_${res.status}` };
  }
  const items = extractItems(res.text);
  if (!items.length) return { articles: [], error: "empty_items" };

  const articles: NewsArticle[] = [];
  for (const block of items.slice(0, 30)) {
    const title = extractTag(block, "title");
    if (!title) continue;
    const link = extractLink(block);
    if (!link) continue;
    const summary =
      extractTag(block, "description") ??
      extractTag(block, "summary") ??
      extractTag(block, "content") ??
      "";
    const publishedAt = parsePublished(block) ?? new Date().toISOString();
    const tags = tagArticle(title, summary);
    articles.push({
      id: articleId(link, title),
      title,
      url: link,
      source: feed.name,
      publishedAt,
      summary: summary.slice(0, 400),
      category: feed.category,
      lang: feed.lang,
      tickers: tags.tickers,
      sectors: tags.sectors,
      symbols: tags.symbols,
    });
  }
  return { articles };
}

function withFeedBudget<T>(p: Promise<T>, ms: number): Promise<T | { articles: []; error: string }> {
  return Promise.race([
    p,
    new Promise<{ articles: []; error: string }>((r) =>
      setTimeout(() => r({ articles: [], error: "feed_budget" }), ms),
    ),
  ]);
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

export async function fetchAllNews(): Promise<NewsArticle[]> {
  const results = await mapPool(FEEDS, CONCURRENCY, (f) =>
    withFeedBudget(fetchFeed(f), FEED_BUDGET_MS),
  );

  const articles: NewsArticle[] = [];
  const errors: string[] = [];
  for (let i = 0; i < FEEDS.length; i++) {
    const r = results[i]! as { articles: NewsArticle[]; error?: string };
    if (r.articles?.length) articles.push(...r.articles);
    else if (r.error) errors.push(`${FEEDS[i]!.name}:${r.error}`);
  }

  // de-dupe by url / id
  const seen = new Set<string>();
  const uniq: NewsArticle[] = [];
  for (const a of articles) {
    const key = a.url || a.id;
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push(a);
  }
  uniq.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  if (!uniq.length) {
    throw new Error(
      `rss-news: all ${FEEDS.length} feeds failed (${errors.slice(0, 3).join("; ")})`,
    );
  }
  return uniq;
}
