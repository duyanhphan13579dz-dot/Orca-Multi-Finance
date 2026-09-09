import "server-only";

/**
 * Lightweight Oracle ADF session client for SSC CongBoThongTin.
 *
 * Flow:
 * 1) GET /faces/NewsSearch → Set-Cookie (JSESSIONID) + bootstrap HTML
 * 2) Follow _afrLoop / Adf-Window-Id URL (full page render ~80KB with table)
 * 3) Parse HTML table rows (no headless browser required for listing)
 *
 * Search-by-ticker uses ADF PPR POST best-effort; falls back to parsing
 * default listing + client filter.
 */

export const SSC_BASE = (process.env.SSC_PORTAL_URL ?? "https://congbothongtin.ssc.gov.vn").replace(
  /\/$/,
  "",
);
export const SSC_NEWS_PATH = "/faces/NewsSearch";

const UA =
  process.env.SSC_HTTP_UA ??
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface AdfSession {
  cookie: string;
  html: string;
  finalUrl: string;
  windowId: string | null;
  afrLoop: string | null;
  latencyMs: number;
}

function mergeCookies(existing: string, setCookieHeaders: string[]): string {
  const map = new Map<string, string>();
  for (const part of existing.split(";").map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf("=");
    if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const sc of setCookieHeaders) {
    const first = sc.split(";")[0]?.trim();
    if (!first) continue;
    const i = first.indexOf("=");
    if (i > 0) map.set(first.slice(0, i), first.slice(i + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function getSetCookies(res: Response): string[] {
  // Node fetch may expose getSetCookie()
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractAfrParams(html: string): { afrLoop: string | null; windowId: string | null } {
  const loop =
    html.match(/_afrLoop[=:](\d+)/)?.[1] ??
    html.match(/_afrLoop=(\d+)/)?.[1] ??
    null;
  const windowId =
    html.match(/Adf-Window-Id[=:]([A-Za-z0-9_-]+)/)?.[1] ??
    html.match(/Adf-Window-Id=([A-Za-z0-9_-]+)/)?.[1] ??
    null;
  return { afrLoop: loop, windowId };
}

function buildAfrUrl(basePath: string, afrLoop: string, windowId: string | null): string {
  const u = new URL(basePath, SSC_BASE);
  u.searchParams.set("_afrLoop", afrLoop);
  u.searchParams.set("_afrWindowMode", "0");
  if (windowId) u.searchParams.set("Adf-Window-Id", windowId);
  u.searchParams.set("_afrFS", "16");
  u.searchParams.set("_afrMT", "screen");
  u.searchParams.set("_afrMFW", "1280");
  u.searchParams.set("_afrMFH", "800");
  return u.toString();
}

/** Bootstrap ADF session and return fully rendered NewsSearch HTML. */
export async function openSscNewsSearch(): Promise<AdfSession> {
  const t0 = performance.now();
  let cookie = "";

  const boot = await fetch(`${SSC_BASE}${SSC_NEWS_PATH}`, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  cookie = mergeCookies(cookie, getSetCookies(boot));
  const bootHtml = await boot.text();
  let { afrLoop, windowId } = extractAfrParams(bootHtml);

  // Fallback: some ADF apps put loop only after cookie session — retry once
  if (!afrLoop) {
    const boot2 = await fetch(`${SSC_BASE}${SSC_NEWS_PATH}`, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html",
        Cookie: cookie,
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });
    cookie = mergeCookies(cookie, getSetCookies(boot2));
    const html2 = await boot2.text();
    const p = extractAfrParams(html2);
    afrLoop = p.afrLoop;
    windowId = p.windowId ?? windowId;
  }

  if (!afrLoop) {
    return {
      cookie,
      html: bootHtml,
      finalUrl: `${SSC_BASE}${SSC_NEWS_PATH}`,
      windowId,
      afrLoop: null,
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  const fullUrl = buildAfrUrl(SSC_NEWS_PATH, afrLoop, windowId ?? "w1");
  const full = await fetch(fullUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      Cookie: cookie,
      Referer: `${SSC_BASE}${SSC_NEWS_PATH}`,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  cookie = mergeCookies(cookie, getSetCookies(full));
  const html = await full.text();
  const params = extractAfrParams(html);

  return {
    cookie,
    html,
    finalUrl: fullUrl,
    windowId: params.windowId ?? windowId,
    afrLoop: params.afrLoop ?? afrLoop,
    latencyMs: Math.round(performance.now() - t0),
  };
}

/**
 * Best-effort ADF PPR search by ticker (MCK field pt9:it8112).
 * Returns HTML fragment or full page if server cooperates; otherwise null.
 */
export async function adfSearchByTicker(
  session: AdfSession,
  symbol: string,
): Promise<{ html: string; ok: boolean; note: string }>
{
  const sym = symbol.toUpperCase();
  if (!session.cookie) {
    return { html: session.html, ok: false, note: "missing_session_cookie" };
  }

  // ADF Rich partial request — field names observed on NewsSearch form
  const body = new URLSearchParams();
  body.set("pt9:it8112", sym);
  body.set("pt9:it8112::content", sym);
  body.set("event", "pt9:b1"); // search button — may vary by deploy
  body.set("event.pt9:b1", "<m xmlns=\"http://oracle.com/richClient/comm\"><k name=\"type\"><s>action</s></k></m>");
  body.set("oracle.adf.view.rich.PROCESS", "pt9:b1,pt9:it8112");

  try {
    const res = await fetch(session.finalUrl || `${SSC_BASE}${SSC_NEWS_PATH}`, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: session.cookie,
        "Adf-Rich-Message": "true",
        "Adf-Ads-For-Packet": "1",
        Referer: session.finalUrl,
        Origin: SSC_BASE,
      },
      body: body.toString(),
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    const hasTable = /pt9:t1:\d+:c5/.test(html) || /role="gridcell"/.test(html);
    return {
      html: hasTable ? html : session.html,
      ok: res.ok && hasTable,
      note: hasTable ? "ppr_search_ok" : `ppr_fallback_default_table HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      html: session.html,
      ok: false,
      note: e instanceof Error ? e.message.slice(0, 120) : "ppr_error",
    };
  }
}
