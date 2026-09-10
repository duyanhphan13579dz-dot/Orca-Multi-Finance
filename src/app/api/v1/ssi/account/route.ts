import { badRequest, fail, ok } from "@/lib/envelope";
import { buildMeta } from "@/lib/freshness";
import { getSessionUser } from "@/lib/auth";
import { ssiFastConfigured } from "@/lib/providers/ssi-fastconnect";
import {
  getFcAccountBalance,
  getFcAccountInfo,
  getFcPpmmr,
  getFcPositions,
  ssiTradingConfigured,
} from "@/lib/providers/ssi-trading";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/v1/ssi/account?accountNo= — thông tin tài khoản SSI FastConnect:
 * danh sách tiểu khoản, số dư, vị thế, PP/MMR.
 *
 * Nhóm TRUY VẤN không cần OTP — chỉ cần apiKey/apiSecret (token data).
 * Yêu cầu đăng nhập ORCA để tránh lộ dữ liệu tài khoản.
 */
export async function GET(req: Request) {
  const session = await getSessionUser();
  if (!session) return fail("UNAUTHENTICATED", "Đăng nhập để truy vấn tài khoản SSI", 401);

  if (!ssiTradingConfigured() || !ssiFastConfigured()) {
    return fail(
      "SSI_NOT_CONFIGURED",
      "Chưa cấu hình SSI FastConnect — set SSI_API_KEY + SSI_API_SECRET (xem /api/v1/ssi/status)",
      503,
    );
  }

  const url = new URL(req.url);
  const requested = url.searchParams.get("accountNo")?.trim() ?? "";

  try {
    const accounts = await getFcAccountInfo();
    if (!accounts.length) {
      return fail("SSI_NO_ACCOUNT", "SSI không trả về tài khoản nào cho apiKey này", 502);
    }
    const accountNo = requested || accounts[0].accountNo;
    if (!accounts.some((a) => a.accountNo === accountNo)) {
      return badRequest(`accountNo ${accountNo} không thuộc apiKey này`);
    }

    const [balance, positions, ppmmr] = await Promise.allSettled([
      getFcAccountBalance(accountNo),
      getFcPositions(accountNo),
      getFcPpmmr(accountNo),
    ]);

    const pick = <T,>(r: PromiseSettledResult<T>) => (r.status === "fulfilled" ? r.value : null);
    const errors = [
      balance.status === "rejected" ? `accountBalance: ${String(balance.reason instanceof Error ? balance.reason.message : balance.reason)}` : null,
      positions.status === "rejected" ? `position: ${String(positions.reason instanceof Error ? positions.reason.message : positions.reason)}` : null,
      ppmmr.status === "rejected" ? `ppmmr: ${String(ppmmr.reason instanceof Error ? ppmmr.reason.message : ppmmr.reason)}` : null,
    ].filter(Boolean) as string[];

    return ok(
      {
        accounts,
        accountNo,
        balance: pick(balance),
        positions: pick(positions),
        ppmmr: pick(ppmmr),
        errors,
      },
      buildMeta({
        source: "ssi-fastconnect",
        sourceTimestampMs: Date.now(),
        degraded: errors.length > 0,
        note: "Truy vấn tài khoản SSI FastConnect v3 (không cần OTP)",
      }),
    );
  } catch (e) {
    return fail("SSI_ACCOUNT_ERROR", e instanceof Error ? e.message : "Lỗi truy vấn tài khoản SSI", 502);
  }
}
