import { badRequest, fail, ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getSessionUser } from "@/lib/auth";
import { ssiFastConfigured } from "@/lib/providers/ssi-fastconnect";
import {
  cancelFcFcoOrder,
  getFcFcoList,
  getFcFcoOrderBook,
  getFcFcoStatusHistory,
  placeFcFcoOrder,
  ssiTradingConfigured,
  ssiTradingEnabled,
} from "@/lib/providers/ssi-trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lệnh điều kiện (FastConnect Conditional Order — FCO).
 * GET  : truy vấn danh sách / orderbook / lịch sử trạng thái (không cần OTP)
 * POST : đặt lệnh điều kiện (ký RSA + token OTP, gated SSI_TRADING_ENABLED)
 * DELETE: hủy lệnh điều kiện (ký RSA + token OTP, gated SSI_TRADING_ENABLED)
 *
 * Tham số chi tiết từng loại lệnh (gtd, stop, stop_limit, trailing_stop,
 * trailing_stop_limit, oco, bullbear): xem phụ lục fco-reference tại
 * https://developers.ssi.com.vn/docs/api-reference/appendix/fco-reference
 */

async function parseBody(req: Request): Promise<Record<string, unknown> | null> {
  return (await req.json().catch(() => null)) as Record<string, unknown> | null;
}

export async function GET(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để truy vấn FCO", 401);
  if (!ssiTradingConfigured() || !ssiFastConfigured()) {
    return fail("SSI_NOT_CONFIGURED", "Chưa cấu hình SSI FastConnect (SSI_API_KEY/SECRET)", 503);
  }

  const url = new URL(req.url);
  const view = url.searchParams.get("view") ?? "list";
  const query: Record<string, string | number | undefined> = {
    accountNo: url.searchParams.get("accountNo") ?? undefined,
    fcoId: url.searchParams.get("fcoId") ?? undefined,
    symbol: url.searchParams.get("symbol") ?? undefined,
    type: url.searchParams.get("type") ?? undefined,
    processStatus: url.searchParams.get("processStatus") ?? undefined,
    fromDate: url.searchParams.get("fromDate") ?? undefined,
    toDate: url.searchParams.get("toDate") ?? undefined,
    pageIndex: url.searchParams.get("pageIndex") ?? undefined,
    pageSize: url.searchParams.get("pageSize") ?? undefined,
  };

  try {
    const data =
      view === "orderbook"
        ? await getFcFcoOrderBook(query)
        : view === "statusHistory"
          ? await getFcFcoStatusHistory(query)
          : await getFcFcoList(query);
    return ok(
      { view, data },
      buildMeta({ source: "ssi-fastconnect", sourceTimestampMs: Date.now(), note: "FCO — SSI FastConnect v3" }),
    );
  } catch (e) {
    return fail("SSI_FCO_QUERY_ERROR", e instanceof Error ? e.message : "Truy vấn FCO thất bại", 502);
  }
}

export async function POST(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đặt FCO", 401);
  if (!ssiTradingConfigured() || !ssiFastConfigured()) {
    return fail("SSI_NOT_CONFIGURED", "Chưa cấu hình SSI FastConnect (SSI_API_KEY/SECRET)", 503);
  }
  if (!ssiTradingEnabled()) {
    return fail("SSI_TRADING_DISABLED", "FCO đang TẮT — cần SSI_PRIVATE_KEY + SSI_TRADING_ENABLED=true", 403);
  }

  const body = await parseBody(req);
  if (!body || typeof body !== "object") return badRequest("Body JSON không hợp lệ");
  const { otp, transactionId, ...fcoBody } = body as { otp?: string; transactionId?: string } & Record<string, unknown>;
  if (!otp && !transactionId) return badRequest("Cần otp hoặc transactionId để đặt FCO");
  if (!fcoBody.accountNo || !fcoBody.type) return badRequest("Thiếu accountNo hoặc type (loại lệnh điều kiện)");

  try {
    const res = await placeFcFcoOrder(fcoBody, { otp: otp as string | undefined, transactionId: transactionId as string | undefined });
    return ok(res, buildMeta({ source: "ssi-fastconnect", sourceTimestampMs: Date.now(), note: "Đặt FCO — SSI FastConnect v3" }));
  } catch (e) {
    return fail("SSI_FCO_PLACE_ERROR", e instanceof Error ? e.message : "Đặt FCO thất bại", 502);
  }
}

export async function DELETE(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để hủy FCO", 401);
  if (!ssiTradingConfigured() || !ssiFastConfigured()) {
    return fail("SSI_NOT_CONFIGURED", "Chưa cấu hình SSI FastConnect (SSI_API_KEY/SECRET)", 503);
  }
  if (!ssiTradingEnabled()) {
    return fail("SSI_TRADING_DISABLED", "FCO đang TẮT — cần SSI_PRIVATE_KEY + SSI_TRADING_ENABLED=true", 403);
  }

  const body = await parseBody(req);
  if (!body) return badRequest("Body JSON không hợp lệ");
  const { otp, transactionId, ...fcoBody } = body as { otp?: string; transactionId?: string } & Record<string, unknown>;
  if (!otp && !transactionId) return badRequest("Cần otp hoặc transactionId để hủy FCO");
  if (!fcoBody.fcoId) return badRequest("Thiếu fcoId");

  try {
    const res = await cancelFcFcoOrder(fcoBody, { otp: otp as string | undefined, transactionId: transactionId as string | undefined });
    return ok(res, buildMeta({ source: "ssi-fastconnect", sourceTimestampMs: Date.now(), note: "Hủy FCO — SSI FastConnect v3" }));
  } catch (e) {
    return fail("SSI_FCO_CANCEL_ERROR", e instanceof Error ? e.message : "Hủy FCO thất bại", 502);
  }
}
