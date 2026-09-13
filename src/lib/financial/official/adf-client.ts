import "server-only";
import { env } from "../../env";

/**
 * Oracle ADF session client — SSC CongBoThongTin
 *
 * Critical discovery (2026-09):
 * - Bootstrap HTML is ~7KB loopback JS; does NOT contain the data table.
 * - Full table (~86KB) loads only via:
 *     /faces/NewsSearch;jsessionid=XXX?_afrLoop=YYY&Adf-Window-Id=w1&...
 * - _afrLoop is embedded in bootstrap as: _afrLoop',\n '34415...
 * - PPR POST must hit the ;jsessionid= path or ViewState expires.
 */

export const SSC_BASE = env.sscPortalUrl;
export const SSC_NEWS_PATH = "/faces/NewsSearch";

const UA = env.sscHttpUa;

export interface AdfSession {
  cookie: string;
  jsessionId: string | null;
  html: string;
  finalUrl: string;
  postUrl: string;
  windowId: string;
  afrLoop: string | null;
  viewState: string | null;
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
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

function extractJsession(cookie: string): string | null {
  const m = cookie.match(/JSESSIONID=([^;\s]+)/i);
  return m?.[1] ?? null;
}

/** Extract _afrLoop from ADF loopback bootstrap JS (not query-string form). */
export function extractAfrLoop(html: string): string | null {
  const patterns = [
    /_afrLoop['"]?\s*[,:]\s*['"]?(\d{10,})/,
    /_afrLoop=(\d{10,})/,
    /["']_afrLoop["']\s*,\s*["'](\d{10,})["']/,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function extractViewState(html: string): string | null {
  return html.match(/name="javax\.faces\.ViewState"[^>]*value="([^"]*)"/)?.[1] ?? null;
}

function buildFullPageUrl(jsessionId: string | null, afrLoop: string, windowId: string): string {
  const path = jsessionId
    ? `${SSC_NEWS_PATH};jsessionid=${jsessionId}`
    : SSC_NEWS_PATH;
  const u = new URL(path, SSC_BASE);
  u.searchParams.set("_afrLoop", afrLoop);
  u.searchParams.set("_afrWindowMode", "0");
  u.searchParams.set("Adf-Window-Id", windowId);
  u.searchParams.set("_afrFS", "16");
  u.searchParams.set("_afrMT", "screen");
  u.searchParams.set("_afrMFW", "1280");
  u.searchParams.set("_afrMFH", "800");
  u.searchParams.set("_afrMFDW", "1280");
  u.searchParams.set("_afrMFDH", "800");
  u.searchParams.set("_afrMFC", "8");
  u.searchParams.set("_afrMFCI", "0");
  u.searchParams.set("_afrMFM", "0");
  u.searchParams.set("_afrMFR", "96");
  u.searchParams.set("_afrMFG", "0");
  u.searchParams.set("_afrMFS", "0");
  u.searchParams.set("_afrMFO", "0");
  return u.toString();
}

function postPath(jsessionId: string | null): string {
  return jsessionId
    ? `${SSC_BASE}${SSC_NEWS_PATH};jsessionid=${jsessionId}`
    : `${SSC_BASE}${SSC_NEWS_PATH}`;
}

/** Bootstrap ADF session and return fully rendered NewsSearch HTML (~86KB with table). */
export async function openSscNewsSearch(): Promise<AdfSession> {
  const t0 = performance.now();
  let cookie = "";
  const windowId = "w1";

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
  const jsessionId = extractJsession(cookie);
  const afrLoop = extractAfrLoop(bootHtml);

  if (!afrLoop) {
    return {
      cookie,
      jsessionId,
      html: bootHtml,
      finalUrl: `${SSC_BASE}${SSC_NEWS_PATH}`,
      postUrl: postPath(jsessionId),
      windowId,
      afrLoop: null,
      viewState: extractViewState(bootHtml),
      latencyMs: Math.round(performance.now() - t0),
    };
  }

  const fullUrl = buildFullPageUrl(jsessionId, afrLoop, windowId);
  const full = await fetch(fullUrl, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml",
      Cookie: cookie,
      Referer: `${SSC_BASE}${SSC_NEWS_PATH}`,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(25_000),
  });
  cookie = mergeCookies(cookie, getSetCookies(full));
  const html = await full.text();

  return {
    cookie,
    jsessionId: extractJsession(cookie) ?? jsessionId,
    html,
    finalUrl: fullUrl,
    postUrl: postPath(extractJsession(cookie) ?? jsessionId),
    windowId,
    afrLoop,
    viewState: extractViewState(html),
    latencyMs: Math.round(performance.now() - t0),
  };
}

function buildPprBody(
  viewState: string,
  fields: Record<string, string>,
  eventSource: string,
): string {
  const body = new URLSearchParams();
  body.set("javax.faces.ViewState", viewState);
  body.set("org.apache.myfaces.trinidad.faces.FORM", "f1");
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  body.set("event", eventSource);
  body.set(
    `event.${eventSource}`,
    `<m xmlns="http://oracle.com/richClient/comm"><k name="type"><s>action</s></k></m>`,
  );
  body.set("oracle.adf.view.rich.PROCESS", Object.keys(fields).concat(eventSource).join(","));
  body.set("oracle.adf.view.rich.DELTAS", "{}");
  body.set("Adf-Page-Id", "0");
  body.set("Adf-Window-Id", "w1");
  return body.toString();
}

/** Merge CDATA updates from partial-response XML into a synthetic HTML blob. */
export function mergePartialResponse(xml: string): {
  html: string;
  viewState: string | null;
  updateIds: string[];
} {
  const updates = [...xml.matchAll(/<update id="([^"]+)">\s*<!\[CDATA\[([\s\S]*?)\]\]><\/update>/g)];
  const parts: string[] = [];
  const updateIds: string[] = [];
  let viewState: string | null = null;
  for (const m of updates) {
    updateIds.push(m[1]);
    if (m[1] === "javax.faces.ViewState") viewState = m[2].trim();
    else parts.push(m[2]);
  }
  return { html: parts.join("\n"), viewState, updateIds };
}

/**
 * PPR search by ticker (field pt9:it8112, button pt9:b1).
 * Posts to ;jsessionid= path — required to avoid ViewExpiredException.
 */
export async function adfSearchByTicker(
  session: AdfSession,
  symbol: string,
): Promise<{ html: string; ok: boolean; note: string; viewState: string | null }> {
  const sym = symbol.toUpperCase();
  if (!session.viewState || !session.cookie) {
    return { html: session.html, ok: false, note: "missing_viewstate_or_cookie", viewState: session.viewState };
  }

  try {
    const body = buildPprBody(session.viewState, { "pt9:it8112": sym }, "pt9:b1");
    const res = await fetch(session.postUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: session.cookie,
        "Adf-Rich-Message": "true",
        Referer: session.finalUrl,
        Origin: SSC_BASE,
      },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const xml = await res.text();

    if (xml.includes("ViewExpiredException")) {
      return { html: session.html, ok: false, note: "view_expired", viewState: null };
    }

    const merged = mergePartialResponse(xml);
    const hasGrid =
      /pt9:t1:\d+:c5/.test(merged.html) ||
      /role="gridcell"/.test(merged.html) ||
      new RegExp(sym).test(merged.html);

    // Table fragment may be absent even when search is accepted — keep default HTML
    return {
      html: hasGrid ? merged.html : session.html,
      ok: hasGrid,
      note: hasGrid
        ? `ppr_ok updates=${merged.updateIds.join(",")}`
        : `ppr_no_table updates=${merged.updateIds.join(",") || "none"}`,
      viewState: merged.viewState ?? session.viewState,
    };
  } catch (e) {
    return {
      html: session.html,
      ok: false,
      note: e instanceof Error ? e.message.slice(0, 120) : "ppr_error",
      viewState: session.viewState,
    };
  }
}

/**
 * Attempt PDF download via commandLink event pt9:t1:{row}:cil4z.
 * Returns bytes + content-type when server streams a file; null otherwise.
 */
export async function adfTryDownloadRow(
  session: AdfSession,
  rowIndex: number,
): Promise<{ ok: boolean; bytes: Uint8Array | null; contentType: string | null; note: string }> {
  if (!session.viewState) {
    return { ok: false, bytes: null, contentType: null, note: "no_viewstate" };
  }
  const source = `pt9:t1:${rowIndex}:cil4z`;
  try {
    const body = buildPprBody(session.viewState, {}, source);
    const res = await fetch(session.postUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Cookie: session.cookie,
        "Adf-Rich-Message": "true",
        Referer: session.finalUrl,
        Origin: SSC_BASE,
      },
      body,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const ct = res.headers.get("content-type") ?? "";
    const buf = new Uint8Array(await res.arrayBuffer());
    const isFile =
      /pdf|octet-stream|msword|spreadsheet|zip/i.test(ct) ||
      Boolean(res.headers.get("content-disposition"));
    if (isFile && buf.byteLength > 100) {
      return { ok: true, bytes: buf, contentType: ct, note: `file ${buf.byteLength}B` };
    }
    const text = new TextDecoder().decode(buf.slice(0, 400));
    if (text.includes("ViewExpiredException")) {
      return { ok: false, bytes: null, contentType: ct, note: "view_expired" };
    }
    return { ok: false, bytes: null, contentType: ct, note: `not_file ${ct} ${buf.byteLength}B` };
  } catch (e) {
    return {
      ok: false,
      bytes: null,
      contentType: null,
      note: e instanceof Error ? e.message.slice(0, 120) : "download_error",
    };
  }
}
