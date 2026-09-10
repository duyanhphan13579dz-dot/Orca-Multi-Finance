import { badRequest, fail, ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getSessionUser } from "@/lib/auth";
import { ssiFastConfigured } from "@/lib/providers/ssi-fastconnect";
import {
  cancelFcOrder,
  FC_ORDER_STATUS,
  getFcOrderBook,
  modifyFcOrder,
  placeFcOrder,
  ssiTradingConfigured,
  ssiTradingEnabled,
  type FcOrderSide,
  type FcOrderType,
} from "@/lib/providers/ssi-trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORDER_TYPES: FcOrderType[] = ["LO", "ATO", "ATC", "MP", "MTL", "MOK", "MAK", "PLO"];

function requireSession() {
  return getSessionUser();
}

function tradingGate() {
  if (!ssiTradingConfigured() || !ssiFastConfigured()) {
    return fail("SSI_NOT_CONFIGURED", "Chưa cấu hình SSI FastConnect (SSI_API_KEY/SECRET)", 503);
  }
  if (!ssiTradingEnabled()) {
    return fail(
      "SSI_TRADING_DISABLED",
      "Đặt/sửa/hủy lệnh đang TẮT. Cần: SSI_PRIVATE_KEY (khóa RSA) + SSI_TRADING_ENABLED=true + token có OTP.",
      403,
    );
  }
  return null;
}

type OrderBody = {
  accountNo?: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  quantity?: number;
  price?: string | number;
  orderId?: string;
  clientRequestId?: string;
  otp?: string;
  transactionId?: string;
  from?: string;
  to?: string;
};

async function parseBody(req: Request): Promise<OrderBody | null> {
  return (await req.json().catch(() => null)) as OrderBody | null;
}

/**
 * GET /api/v1/ssi/orders?accountNo=&from=&to=&symbol=&status=
 * Sổ lệnh hôm nay (hoặc theo khoảng from/to ISO-8601). Không cần OTP.
 */
export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để truy vấn sổ lệnh SSI", 401);
  if (!ssiTradingConfigured() || !ssiFastConfigured()) {
    return fail("SSI_NOT_CONFIGURED", "Chưa cấu hình SSI FastConnect (SSI_API_KEY/SECRET)", 503);
  }

  const url = new URL(req.url);
  const accountNo = url.searchParams.get("accountNo")?.trim();
  if (!accountNo) return badRequest("Thiếu accountNo");

  try {
    const book = await getFcOrderBook(accountNo, {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      symbol: url.searchParams.get("symbol") ?? undefined,
      orderStatus: url.searchParams.get("status") ?? undefined,
      pageIndex: Number(url.searchParams.get("pageIndex") ?? 1) || 1,
      pageSize: Number(url.searchParams.get("pageSize") ?? 50) || 50,
    });
    return ok(
      { orderBook: book, statusLabels: FC_ORDER_STATUS },
      buildMeta({ source: "ssi-fastconnect", sourceTimestampMs: Date.now(), note: "Sổ lệnh — SSI FastConnect v3 orderBook" }),
    );
  } catch (e) {
    return fail("SSI_ORDERBOOK_ERROR", e instanceof Error ? e.message : "Lỗi truy vấn sổ lệnh", 502);
  }
}

/**
 * POST /api/v1/ssi/orders — ĐẶT LỆNH (ký RSA, token OTP).
 * body: {accountNo, symbol, side: "B"|"S", orderType: LO|ATO|ATC|MP|…,
 *        quantity, price?, otp | transactionId}
 */
export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để đặt lệnh SSI", 401);
  const gate = tradingGate();
  if (gate) return gate;

  const body = await parseBody(req);
  if (!body) return badRequest("Body JSON không hợp lệ");
  const { accountNo, symbol, side, orderType, quantity, price, otp, transactionId } = body;
  if (!accountNo || !symbol || !side || !orderType || !quantity) {
    return badRequest("Thiếu trường bắt buộc: accountNo, symbol, side, orderType, quantity");
  }
  if (side !== "B" && side !== "S") return badRequest("side phải là B (mua) hoặc S (bán)");
  if (!ORDER_TYPES.includes(orderType as FcOrderType)) {
    return badRequest(`orderType phải thuộc: ${ORDER_TYPES.join(", ")}`);
  }
  if (!Number.isFinite(quantity) || quantity <= 0) return badRequest("quantity phải là số dương");
  if (!otp && !transactionId) return badRequest("Cần otp (SMS OTP) hoặc transactionId (SmartOTP) để đặt lệnh");

  try {
    const res = await placeFcOrder(
      {
        accountNo,
        symbol,
        side: side as FcOrderSide,
        orderType: orderType as FcOrderType,
        quantity,
        price,
        clientRequestId: undefined,
      },
      { otp, transactionId },
    );
    return ok(
      { ...res, statusLabel: res.orderStatus ? FC_ORDER_STATUS[res.orderStatus] ?? res.orderStatus : null },
      buildMeta({ source: "ssi-fastconnect", sourceTimestampMs: Date.now(), note: "Đặt lệnh — SSI FastConnect v3" }),
    );
  } catch (e) {
    return fail("SSI_PLACE_ORDER_ERROR", e instanceof Error ? e.message : "Đặt lệnh thất bại", 502);
  }
}

/**
 * PUT /api/v1/ssi/orders — SỬA LỆNH (price HOẶC quantity).
 * body: {accountNo, orderId | clientRequestId, price | quantity, otp | transactionId}
 */
export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để sửa lệnh SSI", 401);
  const gate = tradingGate();
  if (gate) return gate;

  const body = await parseBody(req);
  if (!body?.accountNo || (!body.orderId && !body.clientRequestId)) {
    return badRequest("Cần accountNo + (orderId hoặc clientRequestId)");
  }
  if ((body.price == null) === (body.quantity == null)) {
    return badRequest("Chỉ được sửa price HOẶC quantity trong một request");
  }
  if (!body.otp && !body.transactionId) return badRequest("Cần otp hoặc transactionId để sửa lệnh");

  try {
    const res = await modifyFcOrder(
      {
        accountNo: body.accountNo,
        orderId: body.orderId,
        clientRequestId: body.clientRequestId,
        price: body.price,
        quantity: body.quantity,
      },
      { otp: body.otp, transactionId: body.transactionId },
    );
    return ok(res, buildMeta({ source: "ssi-fastconnect", sourceTimestampMs: Date.now(), note: "Sửa lệnh — SSI FastConnect v3" }));
  } catch (e) {
    return fail("SSI_MODIFY_ORDER_ERROR", e instanceof Error ? e.message : "Sửa lệnh thất bại", 502);
  }
}

/**
 * DELETE /api/v1/ssi/orders — HỦY LỆNH.
 * body: {accountNo, orderId | clientRequestId, otp | transactionId}
 */
export async function DELETE(req: Request) {
  const session = await requireSession();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để hủy lệnh SSI", 401);
  const gate = tradingGate();
  if (gate) return gate;

  const body = await parseBody(req);
  if (!body?.accountNo || (!body.orderId && !body.clientRequestId)) {
    return badRequest("Cần accountNo + (orderId hoặc clientRequestId)");
  }
  if (!body.otp && !body.transactionId) return badRequest("Cần otp hoặc transactionId để hủy lệnh");

  try {
    const res = await cancelFcOrder(
      { accountNo: body.accountNo, orderId: body.orderId, clientRequestId: body.clientRequestId },
      { otp: body.otp, transactionId: body.transactionId },
    );
    return ok(res, buildMeta({ source: "ssi-fastconnect", sourceTimestampMs: Date.now(), note: "Hủy lệnh — SSI FastConnect v3" }));
  } catch (e) {
    return fail("SSI_CANCEL_ORDER_ERROR", e instanceof Error ? e.message : "Hủy lệnh thất bại", 502);
  }
}
