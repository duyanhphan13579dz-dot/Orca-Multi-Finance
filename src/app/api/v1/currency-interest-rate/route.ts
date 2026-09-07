import { ok, unavailable } from "@/lib/envelope";
import { getEconomicData } from "@/lib/services/economy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await getEconomicData("currency-interest-rate");
  if (!result) return unavailable("VietnamBiz Data · currency-interest-rate", "Chưa lấy được bảng lãi suất tiền tệ từ VietnamBiz. Vui lòng thử lại sau hoặc xem nguồn gốc.");
  return ok(result.data, result.meta);
}
