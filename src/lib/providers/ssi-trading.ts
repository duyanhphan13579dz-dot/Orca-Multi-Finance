import "server-only";
import crypto from "crypto";
import { httpJson } from "../http";
import { ProviderError } from "./binance";
import { getFcAccessToken, invalidateFcToken, ssiBase, SSI_FASTCONNECT } from "./ssi-fastconnect";

/**
 * SSI FastConnect v3 — Trading & FCO client (developers.ssi.com.vn).
 *
 * Query endpoints (account info, balances, positions, order book, max buy/sell)
 * work with a normal data token — NO OTP required.
 *
 * Mutations (place/modify/cancel order, FCO) require:
 *   1. a token issued WITH OTP (or SmartOTP transactionId), and
 *   2. an `X-Signature` header — RSA PKCS#1 v1.5 + SHA256 over the exact JSON
 *      body, signed with the SSI private key (base64-encoded XML RSAKeyValue).
 *
 * Guard rails: every mutation helper throws unless SSI_PRIVATE_KEY is present,
 * and API routes additionally require SSI_TRADING_ENABLED=true.
 */

/* ------------------------------ signing ---------------------------------- */

function b64ToB64Url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Parse a base64-encoded XML `<RSAKeyValue>` private key (.NET format) into a
 * Node KeyObject usable for RSA-SHA256 signing.
 */
export function parseSsiXmlPrivateKey(privateKeyB64: string): crypto.KeyObject {
  let xml: string;
  try {
    xml = Buffer.from(privateKeyB64.trim(), "base64").toString("utf8");
  } catch {
    throw new ProviderError("ssi-trading: SSI_PRIVATE_KEY is not valid base64", SSI_FASTCONNECT);
  }
  if (!xml.includes("<RSAKeyValue>") && !xml.includes("<Modulus>")) {
    throw new ProviderError("ssi-trading: SSI_PRIVATE_KEY is not an XML RSAKeyValue", SSI_FASTCONNECT);
  }
  const pick = (tag: string): string | null => {
    const m = xml.match(new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"));
    if (!m) return null;
    const val = m[1].replace(/\s+/g, "");
    return val || null;
  };
  const tags: Record<string, string | null> = {
    Modulus: pick("Modulus"),
    Exponent: pick("Exponent"),
    D: pick("D"),
    P: pick("P"),
    Q: pick("Q"),
    DP: pick("DP"),
    DQ: pick("DQ"),
    InverseQ: pick("InverseQ"),
  };
  if (!tags.Modulus || !tags.Exponent || !tags.D) {
    throw new ProviderError("ssi-trading: private key missing Modulus/Exponent/D", SSI_FASTCONNECT);
  }
  const jwk: Record<string, string> = {
    kty: "RSA",
    n: b64ToB64Url(tags.Modulus),
    e: b64ToB64Url(tags.Exponent),
    d: b64ToB64Url(tags.D),
  };
  if (tags.P) jwk.p = b64ToB64Url(tags.P);
  if (tags.Q) jwk.q = b64ToB64Url(tags.Q);
  if (tags.DP) jwk.dp = b64ToB64Url(tags.DP);
  if (tags.DQ) jwk.dq = b64ToB64Url(tags.DQ);
  if (tags.InverseQ) jwk.qi = b64ToB64Url(tags.InverseQ);
  try {
    return crypto.createPrivateKey({ key: jwk as unknown as crypto.JsonWebKey, format: "jwk" });
  } catch (e) {
    throw new ProviderError(
      `ssi-trading: cannot build RSA key (${e instanceof Error ? e.message : "unknown"})`,
      SSI_FASTCONNECT,
    );
  }
}

/** RSA PKCS#1 v1.5 SHA-256 signature of `data`, hex-encoded (X-Signature). */
export function signSsiPayload(data: string, privateKeyB64: string): string {
  const key = parseSsiXmlPrivateKey(privateKeyB64);
  const sig = crypto.sign("sha256", Buffer.from(data, "utf8"), { key, padding: crypto.constants.RSA_PKCS1_PADDING });
  return sig.toString("hex");
}

export function ssiPrivateKey(): string | undefined {
  return process.env.SSI_PRIVATE_KEY?.trim() || undefined;
}

export function ssiTradingSignConfigured(): boolean {
  return Boolean(ssiPrivateKey());
}

function deviceId(): string {
  return process.env.SSI_DEVICE_ID?.trim() || "ORCA-FINANCIAL";
}

/* ------------------------ OTP-enabled token cache ------------------------- */

type TradingTokenResponse = {
  tokenType?: string;
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
  code?: number | string;
  msg?: string;
};

let tradingToken: { accessToken: string; expiresAt: number } | null = null;
let tradingInflight: Promise<string> | null = null;

/**
 * Token WITH trading permission (issued with OTP or SmartOTP transactionId).
 * Cached until 60s before expiry.
 */
export async function getFcTradingToken(input: { otp?: string; transactionId?: string }): Promise<string> {
  if (!input.otp && !input.transactionId) {
    throw new ProviderError("ssi-trading: cần OTP hoặc transactionId để lấy token giao dịch", SSI_FASTCONNECT);
  }
  if (tradingToken && tradingToken.expiresAt - 60_000 > Date.now()) return tradingToken.accessToken;
  if (tradingInflight) return tradingInflight;

  const apiKey = process.env.SSI_API_KEY?.trim();
  const apiSecret = process.env.SSI_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new ProviderError("ssi-trading: missing SSI_API_KEY / SSI_API_SECRET", SSI_FASTCONNECT);
  }

  tradingInflight = (async () => {
    try {
      const res = await httpJson<TradingTokenResponse>(`${ssiBase()}/api/v3/auth/token`, {
        provider: SSI_FASTCONNECT,
        method: "POST",
        timeoutMs: 15_000,
        retries: 1,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, apiSecret, otp: input.otp ?? null, transactionId: input.transactionId ?? null }),
      });
      if (!res.ok || !res.data?.accessToken) {
        const msg = res.data?.msg ?? res.error ?? "unreachable";
        throw new ProviderError(`ssi-trading auth(OTP): ${msg}`, SSI_FASTCONNECT);
      }
      const now = Date.now();
      tradingToken = {
        accessToken: res.data.accessToken,
        expiresAt: typeof res.data.expiresAt === "number" && res.data.expiresAt > now ? res.data.expiresAt : now + 3_500_000,
      };
      return tradingToken.accessToken;
    } finally {
      tradingInflight = null;
    }
  })();
  return tradingInflight;
}

export function invalidateTradingToken() {
  tradingToken = null;
}

/** POST /api/v3/auth/requestOtp — trigger SMS OTP or SmartOTP push approval. */
export async function requestFcOtp(): Promise<{ message?: string; transactionId?: string }> {
  const apiKey = process.env.SSI_API_KEY?.trim();
  const apiSecret = process.env.SSI_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    throw new ProviderError("ssi-trading: missing SSI_API_KEY / SSI_API_SECRET", SSI_FASTCONNECT);
  }
  const res = await httpJson<{ message?: string; transactionId?: string; code?: number; msg?: string }>(
    `${ssiBase()}/api/v3/auth/requestOtp`,
    {
      provider: SSI_FASTCONNECT,
      method: "POST",
      timeoutMs: 15_000,
      retries: 1,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey, apiSecret }),
    },
  );
  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-trading requestOtp: ${res.error ?? res.text?.slice(0, 140) ?? "failed"}`, SSI_FASTCONNECT);
  }
  return { message: res.data.message, transactionId: res.data.transactionId };
}

/* --------------------------- request plumbing ----------------------------- */

type FcError = { code?: number | string; msg?: string };

async function tradingGet<T>(path: string, query: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    qs.set(k, String(v));
  }
  const url = `${ssiBase()}${path}${qs.toString() ? `?${qs}` : ""}`;

  const doFetch = async (token: string) =>
    httpJson<T & FcError>(url, {
      provider: SSI_FASTCONNECT,
      timeoutMs: 14_000,
      retries: 0,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });

  let res = await doFetch(await getFcAccessToken());
  if (!res.ok && (res.status === 401 || res.status === 403)) {
    invalidateFcToken();
    res = await doFetch(await getFcAccessToken());
  }
  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-trading: ${res.error ?? res.status} ${res.text?.slice(0, 160) ?? ""}`.trim(), SSI_FASTCONNECT);
  }
  return res.data as T;
}

async function tradingSigned<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  body: Record<string, unknown>,
  input: { otp?: string; transactionId?: string },
): Promise<T> {
  const pk = ssiPrivateKey();
  if (!pk) {
    throw new ProviderError("ssi-trading: SSI_PRIVATE_KEY chưa được cấu hình (cần để ký lệnh)", SSI_FASTCONNECT);
  }
  const bodyWithDevice = { ...body, deviceId: (body.deviceId as string) ?? deviceId() };
  const bodyStr = JSON.stringify(bodyWithDevice);
  const signature = signSsiPayload(bodyStr, pk);
  const token = await getFcTradingToken(input);

  const doFetch = async (tk: string) =>
    httpJson<T & FcError>(`${ssiBase()}${path}`, {
      provider: SSI_FASTCONNECT,
      method,
      timeoutMs: 18_000,
      retries: 0,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${tk}`,
        "X-Signature": signature,
      },
      body: bodyStr,
    });

  let res = await doFetch(token);
  if (!res.ok && (res.status === 401 || res.status === 403)) {
    invalidateTradingToken();
    const token2 = await getFcTradingToken(input);
    res = await doFetch(token2);
  }
  if (!res.ok || res.data == null) {
    throw new ProviderError(`ssi-trading ${method} ${path}: ${res.error ?? res.status} ${res.text?.slice(0, 220) ?? ""}`.trim(), SSI_FASTCONNECT);
  }
  return res.data as T;
}

/* ------------------------------- queries ---------------------------------- */
/* Query group works with the normal (data) token — no OTP needed. */

export type FcAccount = { accountNo: string; accountType: "CASH" | "MARGIN" | "DERIVATIVE" | string };

/** GET /api/v3/account/info — list of trading accounts. */
export async function getFcAccountInfo(): Promise<FcAccount[]> {
  const rows = await tradingGet<FcAccount[] | { data?: FcAccount[] }>("/api/v3/account/info", {});
  return Array.isArray(rows) ? rows : (rows.data ?? []);
}

/** GET /api/v3/trading/accountBalance — cash + derivative balances. */
export async function getFcAccountBalance(accountNo: string) {
  return tradingGet<Record<string, unknown>>("/api/v3/trading/accountBalance", { accountNo });
}

/** GET /api/v3/trading/ppmmrAccount — purchasing power / margin ratio. */
export async function getFcPpmmr(accountNo: string) {
  return tradingGet<Record<string, unknown>>("/api/v3/trading/ppmmrAccount", { accountNo });
}

/** GET /api/v3/trading/position — current positions. */
export async function getFcPositions(accountNo: string) {
  return tradingGet<Record<string, unknown>>("/api/v3/trading/position", { accountNo });
}

/** GET /api/v3/trading/orderBook — order history in [from, to] (ISO 8601). */
export async function getFcOrderBook(
  accountNo: string,
  opts?: { from?: string; to?: string; symbol?: string; orderStatus?: string; pageIndex?: number; pageSize?: number },
) {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  return tradingGet<Record<string, unknown>>("/api/v3/trading/orderBook", {
    accountNo,
    from: opts?.from ?? startOfDay.toISOString(),
    to: opts?.to ?? now.toISOString(),
    symbol: opts?.symbol,
    orderStatus: opts?.orderStatus,
    pageIndex: opts?.pageIndex,
    pageSize: opts?.pageSize ?? 100,
  });
}

/** GET /api/v3/trading/maxBuySell — max buy/sell quantity at a price. */
export async function getFcMaxBuySell(accountNo: string, symbol: string, price?: number) {
  return tradingGet<Record<string, unknown>>("/api/v3/trading/maxBuySell", {
    accountNo,
    symbol: symbol.toUpperCase(),
    price,
  });
}

/* ------------------------------- mutations -------------------------------- */
/* Mutations require an OTP token + RSA signature (X-Signature header). */

export type FcOrderSide = "B" | "S";
export type FcOrderType = "LO" | "ATO" | "ATC" | "MP" | "MTL" | "MOK" | "MAK" | "PLO";

export type FcPlaceOrderInput = {
  accountNo: string;
  symbol: string;
  side: FcOrderSide;
  orderType: FcOrderType;
  quantity: number;
  /** required for LO */
  price?: string | number;
  clientRequestId?: string;
};

export type FcOrderResponse = {
  clientRequestId?: string;
  orderId?: string;
  orderStatus?: string;
  clientModifyId?: string;
  clientCancelId?: string;
  code?: number | string;
  msg?: string;
};

function genRequestId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

/** POST /api/v3/trading/order — place a new order (signed). */
export async function placeFcOrder(
  input: FcPlaceOrderInput,
  auth: { otp?: string; transactionId?: string },
): Promise<FcOrderResponse> {
  const body: Record<string, unknown> = {
    clientRequestId: input.clientRequestId ?? genRequestId("ORCA"),
    accountNo: input.accountNo,
    symbol: input.symbol.toUpperCase(),
    side: input.side,
    orderType: input.orderType,
    quantity: input.quantity,
    deviceId: deviceId(),
  };
  if (input.orderType === "LO") {
    if (input.price == null) throw new ProviderError("ssi-trading: price bắt buộc với lệnh LO", SSI_FASTCONNECT);
    body.price = String(input.price);
  } else if (input.price != null) {
    body.price = String(input.price);
  }
  return tradingSigned<FcOrderResponse>("POST", "/api/v3/trading/order", body, auth);
}

/** PUT /api/v3/trading/order — modify price OR quantity (signed). */
export async function modifyFcOrder(
  input: {
    accountNo: string;
    orderId?: string;
    clientRequestId?: string;
    price?: string | number;
    quantity?: number;
  },
  auth: { otp?: string; transactionId?: string },
): Promise<FcOrderResponse> {
  if ((input.price == null) === (input.quantity == null)) {
    throw new ProviderError("ssi-trading: sửa lệnh chỉ được chọn price HOẶC quantity", SSI_FASTCONNECT);
  }
  const body: Record<string, unknown> = {
    accountNo: input.accountNo,
    clientModifyId: genRequestId("ORCAM"),
    deviceId: deviceId(),
  };
  if (input.orderId) body.orderId = input.orderId;
  if (input.clientRequestId) body.clientRequestId = input.clientRequestId;
  if (input.price != null) body.price = String(input.price);
  if (input.quantity != null) body.quantity = input.quantity;
  return tradingSigned<FcOrderResponse>("PUT", "/api/v3/trading/order", body, auth);
}

/** DELETE /api/v3/trading/order — cancel an order (signed). */
export async function cancelFcOrder(
  input: { accountNo: string; orderId?: string; clientRequestId?: string },
  auth: { otp?: string; transactionId?: string },
): Promise<FcOrderResponse> {
  const body: Record<string, unknown> = {
    accountNo: input.accountNo,
    clientCancelId: genRequestId("ORCAC"),
    deviceId: deviceId(),
  };
  if (input.orderId) body.orderId = input.orderId;
  if (input.clientRequestId) body.clientRequestId = input.clientRequestId;
  return tradingSigned<FcOrderResponse>("DELETE", "/api/v3/trading/order", body, auth);
}

/* ------------------------------- FCO -------------------------------------- */

/**
 * POST /api/v3/trading/fco/order — place a conditional order (signed).
 * Body params per type follow the appendix `fco-reference`
 * (gtd / stop / stop_limit / trailing_stop / trailing_stop_limit / oco / bullbear).
 */
export async function placeFcFcoOrder(
  body: Record<string, unknown>,
  auth: { otp?: string; transactionId?: string },
): Promise<Record<string, unknown>> {
  return tradingSigned<Record<string, unknown>>("POST", "/api/v3/trading/fco/order", body, auth);
}

/** DELETE /api/v3/trading/fco/order — cancel a conditional order (signed). */
export async function cancelFcFcoOrder(
  body: Record<string, unknown>,
  auth: { otp?: string; transactionId?: string },
): Promise<Record<string, unknown>> {
  return tradingSigned<Record<string, unknown>>("DELETE", "/api/v3/trading/fco/order", body, auth);
}

/** GET /api/v3/trading/fco/list — list conditional orders. */
export async function getFcFcoList(query: Record<string, string | number | undefined>) {
  return tradingGet<Record<string, unknown>>("/api/v3/trading/fco/list", query);
}

/** GET /api/v3/trading/fco/orderbook — FCO trigger/match log. */
export async function getFcFcoOrderBook(query: Record<string, string | number | undefined>) {
  return tradingGet<Record<string, unknown>>("/api/v3/trading/fco/orderbook", query);
}

/** GET /api/v3/trading/fco/statusHistory — FCO status history. */
export async function getFcFcoStatusHistory(query: Record<string, string | number | undefined>) {
  return tradingGet<Record<string, unknown>>("/api/v3/trading/fco/statusHistory", query);
}

/* ------------------------------- status ----------------------------------- */

export function ssiTradingConfigured(): boolean {
  return Boolean(process.env.SSI_API_KEY?.trim() && process.env.SSI_API_SECRET?.trim());
}

/** Safety gate for order mutations exposed via API routes. */
export function ssiTradingEnabled(): boolean {
  return process.env.SSI_TRADING_ENABLED === "true" && ssiTradingConfigured() && ssiTradingSignConfigured();
}

/** 16 order states (appendix/order-status-flow) — human-readable Vi labels. */
export const FC_ORDER_STATUS: Record<string, string> = {
  PD: "Chờ gửi",
  RS: "Đã nhận",
  SD: "Đã gửi sàn",
  QU: "Đang chờ khớp",
  PF: "Khớp một phần",
  FF: "Khớp toàn bộ",
  WC: "Chờ hủy",
  CL: "Đã hủy",
  RJ: "Bị từ chối",
  EX: "Hết hiệu lực",
  RD: "Đã bị từ chối bởi sàn",
  CA: "Đã hủy bởi khách",
  MO: "Đang chờ sửa",
  MP: "Đã sửa",
  MR: "Sửa bị từ chối",
  MC: "Sửa bị hủy",
};
