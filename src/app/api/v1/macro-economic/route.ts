import { ok, unavailable } from "@/lib/envelope";
import { getEconomicData } from "@/lib/services/economy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const result = await getEconomicData("macro-economic");
  if (!result) return unavailable("VietnamBiz Data · macro-economic", "Chưa lấy được bảng kinh tế vĩ mô từ VietnamBiz. Vui lòng thử lại sau hoặc xem nguồn gốc.");
  return ok(result.data, result.meta);
}
