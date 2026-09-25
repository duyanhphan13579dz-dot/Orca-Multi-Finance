import "server-only";
import { SignJWT, importPKCS8 } from "jose";

/**
 * Minimal Google Sheets API v4 client (service account).
 * Env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_ID
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

export type SheetsConfig = {
  email: string;
  privateKey: string;
  spreadsheetId: string;
};

export function getSheetsConfig(): SheetsConfig | null {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  let privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  const spreadsheetId = process.env.GOOGLE_SHEETS_ID?.trim();
  if (!email || !privateKey || !spreadsheetId) return null;
  privateKey = privateKey.replace(/\\n/g, "\n");
  return { email, privateKey, spreadsheetId };
}

export function isSheetsConfigured(): boolean {
  return getSheetsConfig() !== null;
}

let cachedToken: { access: string; exp: number } | null = null;

async function getAccessToken(cfg: SheetsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp > now + 60) return cachedToken.access;

  const key = await importPKCS8(cfg.privateKey, "RS256");
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(cfg.email)
    .setSubject(cfg.email)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token: ${data.error ?? res.status}`);
  }
  cachedToken = {
    access: data.access_token,
    exp: now + (data.expires_in ?? 3600),
  };
  return data.access_token;
}

async function sheetsFetch(cfg: SheetsConfig, path: string, init?: RequestInit): Promise<Response> {
  const token = await getAccessToken(cfg);
  return fetch(`${SHEETS_BASE}/${cfg.spreadsheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
}

export async function readRange(range: string): Promise<string[][]> {
  const cfg = getSheetsConfig();
  if (!cfg) throw new Error("Google Sheets not configured");
  const q = encodeURIComponent(range);
  const res = await sheetsFetch(cfg, `/values/${q}`);
  const data = (await res.json()) as { values?: string[][]; error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? `Sheets read ${res.status}`);
  return data.values ?? [];
}

export async function writeRange(range: string, values: (string | number | null)[][]): Promise<void> {
  const cfg = getSheetsConfig();
  if (!cfg) throw new Error("Google Sheets not configured");
  const q = encodeURIComponent(range);
  const res = await sheetsFetch(cfg, `/values/${q}?valueInputOption=USER_ENTERED`, {
    method: "PUT",
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? `Sheets write ${res.status}`);
  }
}

export async function appendRows(range: string, values: (string | number | null)[][]): Promise<void> {
  const cfg = getSheetsConfig();
  if (!cfg) throw new Error("Google Sheets not configured");
  const q = encodeURIComponent(range);
  const res = await sheetsFetch(
    cfg,
    `/values/${q}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values }) },
  );
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? `Sheets append ${res.status}`);
  }
}

export async function ensureSheetWithHeaders(title: string, headers: string[]): Promise<void> {
  const cfg = getSheetsConfig();
  if (!cfg) throw new Error("Google Sheets not configured");

  try {
    const rows = await readRange(`${title}!A1:Z1`);
    if (rows[0]?.length) return;
  } catch {
    const token = await getAccessToken(cfg);
    await fetch(`${SHEETS_BASE}/${cfg.spreadsheetId}:batchUpdate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title } } }],
      }),
      signal: AbortSignal.timeout(12_000),
    }).catch(() => null);
  }
  await writeRange(`${title}!A1`, [headers]);
}
