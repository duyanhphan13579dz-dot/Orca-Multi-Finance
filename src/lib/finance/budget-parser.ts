/**
 * BUDGET QUESTION PARSER — trích ngân sách/chu kỳ/khoản cố định từ câu hỏi
 * tiếng Việt tự nhiên ("Tôi còn 500k tiêu trong 2 tuần, 1 tuần xăng hết 50k…").
 * Deterministic, KHÔNG đoán khi không đọc được → null (tool sẽ trả UNAVAILABLE).
 * Dữ liệu trích ra KHÔNG bao giờ được lưu vào Financial Memory (không consent
 * trong luồng này) — chỉ dùng cho 1 lần trả lời.
 */

export interface ParsedBudget {
  totalAmount: number | null;
  weeks: number | null;
  fixedExpenses: { label: string; amount: number; per: "week" | "period" }[];
  matched: string[];
}

interface AmountHit {
  raw: string;
  value: number;
  index: number;
  end: number;
}

const SUFFIX_MULT: Record<string, number> = {
  k: 1_000,
  nghin: 1_000, // "nghìn"/"ngàn" sau normalize
  ngan: 1_000,
  tr: 1_000_000,
  trieu: 1_000_000, // "triệu" sau normalize
  ty: 1_000_000_000, // "tỷ"/"tỉ" sau normalize
  m: 1_000_000,
  million: 1_000_000,
  vnd: 1,
  d: 1, // "đ"
};

/** "1,5 triệu" / "500k" / "50kđ" / "1 tỷ" → số VNĐ. Chỉ nhận khi có hậu tố tiền tệ. */
export function parseAmounts(text: string): { raw: string; value: number }[] {
  return parseAmountHits(text).map(({ raw, value }) => ({ raw, value }));
}

function parseAmountHits(text: string): AmountHit[] {
  const out: AmountHit[] = [];
  // ưu tiên hậu tố dài trước: triệu > nghìn/ngàn > tr > tỷ/tỉ > million > k > vnd > đ
  const re = /(\d+(?:[.,]\d+)*)\s*(triệu|nghìn|ngàn|tr|tỷ|tỉ|m(?:illion)?|k|vnd|đ)/gi;
  for (const m of text.matchAll(re)) {
    const rawNum = m[1];
    // "500.000" / "1.500.000" → hàng nghìn (strip dot khi có nhóm 3 chữ số)
    // "1,5" / "1.5" → thập phân
    let numStr = rawNum.replace(/,/g, ".");
    if (/\.\d{3}(\.\d{3})*$/.test(numStr)) numStr = numStr.replace(/\./g, "");
    const num = Number(numStr);
    if (!Number.isFinite(num)) continue;
    const suffix = m[2]
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d");
    const key = suffix === "trieu" ? "trieu" : suffix === "ty" ? "ty" : suffix;
    const mult = SUFFIX_MULT[key];
    if (!mult) continue;
    const idx = m.index ?? 0;
    out.push({ raw: m[0].trim(), value: Math.round(num * mult), index: idx, end: idx + m[0].length });
  }
  return out;
}

const FIXED_KEYWORDS: { re: RegExp; label: string }[] = [
  { re: /đổ xăng|xăng|nhiên liệu/i, label: "Xăng" },
  { re: /ăn quán|ăn ngoài|ăn uống|tiền cơm|cơm bình dân|ăn\b/i, label: "Ăn uống" },
  { re: /thuê nhà|tiền nhà|nhà trọ|\btrọ\b/i, label: "Nhà ở" },
  { re: /điện nước|tiền điện|tiền nước|internet|mạng|wifi/i, label: "Điện nước & mạng" },
  { re: /học phí|học thêm/i, label: "Học phí" },
  { re: /đi lại|xe buýt|grab|taxi|phí gửi xe/i, label: "Đi lại" },
  { re: /điện thoại|sim|data/i, label: "Liên lạc" },
  { re: /thuốc|khám bệnh|bảo hiểm/i, label: "Sức khỏe" },
];

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function parseBudgetQuestion(text: string): ParsedBudget {
  const matched: string[] = [];
  const amounts = parseAmountHits(normalizeSpaces(text));
  const firstMoney = amounts[0]?.value ?? null;
  const totalAmount = firstMoney;

  // chu kỳ: ưu tiên "N tuần" → "N tháng" (→ 4.33 tuần) → cụm từ không số
  // ("cuối tháng", "tháng này", "hết tuần"…) → "N ngày" (→ /7)
  let weeks: number | null = null;
  const weekMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(tuần|week)/i);
  const monthMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(tháng|month)/i);
  const dayMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(ngày|day)/i);
  const monthPhrase = /(cuối|hết|cả|trong|này|nay)\s*tháng|tháng\s*(này|tới|sau)|một tháng|1 tháng/i;
  const weekPhrase = /(cuối|hết)\s*(tuần|tuần này|tuần tới|tuần sau)|tuần\s*(này|tới|sau)/i;
  if (weekMatch) weeks = Number(weekMatch[1].replace(",", "."));
  else if (monthMatch) weeks = Math.round(Number(monthMatch[1].replace(",", ".")) * 43.3) / 10;
  else if (monthPhrase.test(text)) weeks = 4.33; // "sống đến cuối tháng" ≈ 1 tháng
  else if (weekPhrase.test(text)) weeks = 1;
  else if (dayMatch) weeks = Math.round((Number(dayMatch[1].replace(",", ".")) / 7) * 100) / 100;
  if (weeks != null && (!Number.isFinite(weeks) || weeks <= 0)) weeks = null;

  // khoản cố định: keyword + số tiền gần nhất (trước hoặc sau ≤ 45 ký tự)
  const fixedExpenses: { label: string; amount: number; per: "week" | "period" }[] = [];
  const usedIndex = new Set<number>();
  for (const kw of FIXED_KEYWORDS) {
    const km = kw.re.exec(normalizeSpaces(text));
    if (!km) continue;
    const kwIndex = km.index;
    // candidates gần keyword, sắp theo khoảng cách; chọn cái CHƯA dùng gần nhất
    const candidates = amounts
      .map((a) => ({ a, dist: a.index <= kwIndex ? kwIndex - a.end : a.index - (kwIndex + km[0].length) }))
      .filter((c) => c.dist <= 45)
      .sort((x, y) => x.dist - y.dist);
    const best = candidates.find((c) => !usedIndex.has(c.a.index))?.a ?? null;
    if (best) {
      // per="week" nếu clause gần đó có "tuần/ngày", else "period"
      const before = text.slice(Math.max(0, kwIndex - 70), kwIndex + km[0].length + 30);
      const per: "week" | "period" = /tuần|ngày|mỗi ngày|hằng ngày/.test(before) ? "week" : "period";
      fixedExpenses.push({ label: kw.label, amount: best.value, per });
      usedIndex.add(best.index);
      matched.push(`${kw.label}: ${best.raw}`);
    }
  }

  return { totalAmount, weeks, fixedExpenses, matched };
}
