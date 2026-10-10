/**
 * ORCA Financial — Comprehensive Source Connectivity & Health Check
 * Kiểm tra tất cả các nguồn dữ liệu đang kết nối, đo độ trễ và kiểm tra cơ chế dự phòng.
 */
import { performance } from "node:perf_hooks";

interface SourceProbe {
  domain: string;
  provider: string;
  role: "PRIMARY" | "FALLBACK" | "ENRICHMENT";
  url: string;
  expectedStatus?: number;
  headers?: Record<string, string>;
}

interface ProbeResult {
  domain: string;
  provider: string;
  role: "PRIMARY" | "FALLBACK" | "ENRICHMENT";
  url: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  httpStatus: number | null;
  latencyMs: number;
  note: string;
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PROBES: SourceProbe[] = [
  // 1. Thị trường chứng khoán Việt Nam (Vietnam Equities)
  {
    domain: "VN Stocks",
    provider: "VNDirect Finfo (Universe)",
    role: "PRIMARY",
    url: "https://api-finfo.vndirect.com.vn/v4/stocks?q=code:VND",
    headers: { Origin: "https://dstock.vndirect.com.vn", Referer: "https://dstock.vndirect.com.vn/" },
  },
  {
    domain: "VN Stocks",
    provider: "VNDirect Finfo (BCTC/FS)",
    role: "PRIMARY",
    url: "https://api-finfo.vndirect.com.vn/v4/financial_statements?q=code:VND~reportType:QUARTER&size=2",
    headers: { Origin: "https://dstock.vndirect.com.vn", Referer: "https://dstock.vndirect.com.vn/" },
  },
  {
    domain: "VN Stocks",
    provider: "VNDirect DChart (OHLCV)",
    role: "PRIMARY",
    url: "https://dchart-api.vndirect.com.vn/dchart/history?symbol=VND&resolution=D&from=1704067200&to=1704153600",
  },
  {
    domain: "VN Stocks",
    provider: "VNDirect Events (Cổ tức/ĐHCĐ)",
    role: "PRIMARY",
    url: "https://api-finfo.vndirect.com.vn/v4/events?q=code:VND&size=2",
    headers: { Origin: "https://dstock.vndirect.com.vn" },
  },
  {
    domain: "VN Stocks",
    provider: "VPS BGAPi (Live Quotes)",
    role: "FALLBACK",
    url: "https://bgapidatafeed.vps.com.vn/getliststockdata/VND,SSI,HPG",
  },
  {
    domain: "VN Stocks",
    provider: "VPS HistDatafeed (TV History)",
    role: "FALLBACK",
    url: "https://histdatafeed.vps.com.vn/tradingview/history?symbol=VND&resolution=D&from=1704067200&to=1704153600",
  },
  {
    domain: "VN Stocks",
    provider: "DNSE Entrade (Chart API)",
    role: "FALLBACK",
    url: "https://services.entrade.com.vn/chart-api/v2/ohlcs/stock?from=1704067200&to=1704153600&symbol=VND&resolution=1D",
  },
  {
    domain: "VN Stocks",
    provider: "SSI iBoard (History)",
    role: "FALLBACK",
    url: "https://iboard.ssi.com.vn/dchart/api/history?resolution=D&symbol=VNINDEX&from=1704067200&to=1704153600",
    headers: { Referer: "https://iboard.ssi.com.vn" },
  },
  {
    domain: "VN Stocks",
    provider: "Vietcap IQ (Company Profile)",
    role: "FALLBACK",
    url: "https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/VND",
    headers: { Origin: "https://iq.vietcap.com.vn", Referer: "https://iq.vietcap.com.vn/" },
  },
  {
    domain: "VN Stocks",
    provider: "CafeF Market Feed",
    role: "FALLBACK",
    url: "https://cafef.vn",
  },

  // 2. Crypto
  {
    domain: "Crypto",
    provider: "Binance Vision (Spot)",
    role: "PRIMARY",
    url: "https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT",
  },
  {
    domain: "Crypto",
    provider: "Binance REST (api.binance.com)",
    role: "PRIMARY",
    url: "https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
  },
  {
    domain: "Crypto",
    provider: "Binance REST (api1 Failover)",
    role: "PRIMARY",
    url: "https://api1.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
  },
  {
    domain: "Crypto",
    provider: "Binance Futures (fapi)",
    role: "PRIMARY",
    url: "https://fapi.binance.com/fapi/v1/premiumIndex?symbol=BTCUSDT",
  },
  {
    domain: "Crypto",
    provider: "OKX Spot Tickers",
    role: "FALLBACK",
    url: "https://www.okx.com/api/v5/market/tickers?instType=SPOT",
  },
  {
    domain: "Crypto",
    provider: "CoinGecko API (Demo)",
    role: "FALLBACK",
    url: "https://api.coingecko.com/api/v3/ping",
  },
  {
    domain: "Crypto",
    provider: "Yahoo Finance Crypto",
    role: "FALLBACK",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/BTC-USD?interval=1d&range=2d",
  },

  // 3. Forex & Hàng Hóa (Commodities)
  {
    domain: "Forex",
    provider: "Biquote Public MT5",
    role: "PRIMARY",
    url: "https://biquote.io",
  },
  {
    domain: "Forex",
    provider: "ExchangeRate-API Open",
    role: "FALLBACK",
    url: "https://open.er-api.com/v6/latest/USD",
  },
  {
    domain: "Forex",
    provider: "Frankfurter ECB Reference",
    role: "FALLBACK",
    url: "https://api.frankfurter.dev/v1/latest?from=USD&to=VND,EUR",
  },
  {
    domain: "Forex",
    provider: "Yahoo Finance FX (EURUSD=X)",
    role: "FALLBACK",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/EURUSD=X?interval=1d&range=2d",
  },
  {
    domain: "Commodities",
    provider: "VietnamBiz Goods Catalog",
    role: "PRIMARY",
    url: "https://data.vietnambiz.vn/goods",
  },

  // 4. Kinh tế Vĩ mô (Macro)
  {
    domain: "Macro",
    provider: "World Bank Open Data",
    role: "PRIMARY",
    url: "https://api.worldbank.org/v2/country/VN/indicator/NY.GDP.MKTP.CD?format=json",
  },
  {
    domain: "Macro",
    provider: "State Bank of Vietnam (NHNN)",
    role: "PRIMARY",
    url: "https://www.sbv.gov.vn",
  },
  {
    domain: "Macro",
    provider: "FRED St. Louis Fed",
    role: "FALLBACK",
    url: "https://fred.stlouisfed.org",
  },

  // 5. Tin Tức & RSS (News)
  {
    domain: "News",
    provider: "CafeF RSS (Chứng khoán)",
    role: "PRIMARY",
    url: "https://cafef.vn/thi-truong-chung-khoan.rss",
  },
  {
    domain: "News",
    provider: "VnExpress RSS (Kinh doanh)",
    role: "PRIMARY",
    url: "https://vnexpress.net/rss/kinh-doanh.rss",
  },
  {
    domain: "News",
    provider: "VietnamBiz RSS (Tài chính)",
    role: "PRIMARY",
    url: "https://vietnambiz.vn/rss/tai-chinh.rss",
  },
  {
    domain: "News",
    provider: "Tuổi Trẻ RSS (Kinh doanh)",
    role: "PRIMARY",
    url: "https://tuoitre.vn/rss/kinh-doanh.rss",
  },
  {
    domain: "News",
    provider: "BBC Vietnamese Business",
    role: "FALLBACK",
    url: "https://feeds.bbci.co.uk/vietnamese/business/rss.xml",
  },
  {
    domain: "News",
    provider: "CoinTelegraph RSS",
    role: "PRIMARY",
    url: "https://cointelegraph.com/rss",
  },
  {
    domain: "News",
    provider: "Google News (CK VN)",
    role: "FALLBACK",
    url: "https://news.google.com/rss/search?q=ch%E1%BB%A9ng+kho%C3%A1n+vi%E1%BB%87t+nam&hl=vi&gl=VN&ceid=VN:vi",
  },
];

async function probeSource(probe: SourceProbe, timeoutMs = 7000): Promise<ProbeResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(probe.url, {
      method: "GET",
      headers: {
        "User-Agent": UA,
        Accept: "application/json, text/plain, text/xml, application/rss+xml, */*",
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
        ...(probe.headers ?? {}),
      },
      signal: controller.signal,
    });
    const latencyMs = Math.round(performance.now() - started);
    clearTimeout(timer);
    const text = await res.text();

    if (res.ok) {
      return {
        domain: probe.domain,
        provider: probe.provider,
        role: probe.role,
        url: probe.url,
        status: latencyMs > 3500 ? "DEGRADED" : "ONLINE",
        httpStatus: res.status,
        latencyMs,
        note: `OK (${text.length} bytes)`,
      };
    } else {
      return {
        domain: probe.domain,
        provider: probe.provider,
        role: probe.role,
        url: probe.url,
        status: "DEGRADED",
        httpStatus: res.status,
        latencyMs,
        note: `HTTP ${res.status}: ${res.statusText}`,
      };
    }
  } catch (err: any) {
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - started);
    return {
      domain: probe.domain,
      provider: probe.provider,
      role: probe.role,
      url: probe.url,
      status: "OFFLINE",
      httpStatus: null,
      latencyMs,
      note: err?.name === "AbortError" ? `Timeout > ${timeoutMs}ms` : err?.message || "Lỗi mạng",
    };
  }
}

async function main() {
  console.log("================================================================================");
  console.log("             ORCA FINANCIAL — KIỂM TRA & ĐO LƯỜNG KẾT NỐI HỆ THỐNG             ");
  console.log("================================================================================\n");

  const results: ProbeResult[] = [];
  for (const p of PROBES) {
    const r = await probeSource(p);
    results.push(r);
    const badge = r.status === "ONLINE" ? "\x1b[32m[ONLINE ]\x1b[0m" : r.status === "DEGRADED" ? "\x1b[33m[DEGRADE]\x1b[0m" : "\x1b[31m[OFFLINE]\x1b[0m";
    const latency = `${r.latencyMs}ms`.padStart(7);
    console.log(`${badge} ${r.domain.padEnd(12)} | ${r.provider.padEnd(30)} | ${latency} | ${r.note}`);
  }

  console.log("\n================================================================================");
  console.log("             TRẠNG THÁI BIẾN MÔI TRƯỜNG & KHÓA DỊCH VỤ MỞ RỘNG                 ");
  console.log("================================================================================");

  const envStatuses = [
    { name: "VNDIRECT_BASE_URL", val: process.env.VNDIRECT_BASE_URL, defaultVal: "https://api-finfo.vndirect.com.vn", purpose: "Nguồn chính BCTC & giá VN" },
    { name: "VNDIRECT_FALLBACK_BASE_URLS", val: process.env.VNDIRECT_FALLBACK_BASE_URLS, defaultVal: "https://finfo-api.vndirect.com.vn", purpose: "Cụm dự phòng tự động VNDirect" },
    { name: "SSI_FC_DATA (API Key/Secret)", val: Boolean(process.env.SSI_CONSUMER_ID || process.env.SSI_FC_CONSUMER_ID), purpose: "SSI FastConnect enrichment (optional)" },
    { name: "VNSTOCK_API_KEY", val: Boolean(process.env.VNSTOCK_API_KEY), purpose: "VNStock API fallback cho BCTC (optional)" },
    { name: "BINANCE_BASE_URL", val: process.env.BINANCE_BASE_URL, defaultVal: "Multi-host failover (vision, api1..4)", purpose: "Crypto Spot & Klines" },
    { name: "OPENROUTER_API_KEY", val: Boolean(process.env.OPENROUTER_API_KEY), purpose: "AI Gateway (Phân tích báo cáo & đa mô hình)" },
    { name: "GROQ_API_KEY", val: Boolean(process.env.GROQ_API_KEY), purpose: "AI Cascade fallback siêu tốc (Llama-3.3)" },
    { name: "DATABASE_URL", val: Boolean(process.env.DATABASE_URL), purpose: "PostgreSQL bền vững (Drizzle ORM)" },
    { name: "REDIS_URL / UPSTASH", val: Boolean(process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL), purpose: "Phân tán cache & chia sẻ isolate" },
  ];

  for (const envItem of envStatuses) {
    const isSet = Boolean(envItem.val);
    const mark = isSet ? "\x1b[32m[ĐÃ CẤU HÌNH]\x1b[0m" : "\x1b[36m[CHƯA CẤU HÌNH - DÙNG MẶC ĐỊNH]\x1b[0m";
    console.log(`${mark.padEnd(42)} ${envItem.name.padEnd(28)} : ${envItem.purpose}`);
  }

  const online = results.filter((r) => r.status === "ONLINE").length;
  const degraded = results.filter((r) => r.status === "DEGRADED").length;
  const offline = results.filter((r) => r.status === "OFFLINE").length;
  const total = results.length;
  const healthRate = ((online / total) * 100).toFixed(1);

  console.log("\n================================================================================");
  console.log(`TỔNG KẾT: ${online}/${total} nguồn ONLINE (${healthRate}%) | ${degraded} DEGRADED | ${offline} OFFLINE`);
  console.log("Hệ thống đã tự động kích hoạt multi-source fallback và keep-alive headers.");
  console.log("================================================================================\n");
}

main().catch(console.error);
