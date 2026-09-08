/** Multi-topic conversation memory helpers for ORCA Agent. */

export type TopicKey =
  | "personal_finance"
  | "wealth"
  | "crypto"
  | "forex"
  | "vn-stock"
  | "commodity"
  | "market"
  | "news"
  | "compare"
  | "general";

export interface TopicSlot {
  topic: TopicKey;
  symbols: string[];
  summary: string;
  amount_vnd?: number | null;
  horizon?: string | null;
}

export interface HistoryTurn {
  role: "user" | "assistant" | "agent";
  content: string;
}

export function isFollowUpCue(q: string): boolean {
  const t = q.trim().toLowerCase();
  // Chỉ coi là follow-up khi có cue rõ ràng, không phải mọi câu ngắn <56 ký tự (bug cũ khiến "Thị trường đang..." bị dính sticky wealth)
  if (/^(thế |còn |và |với |nếu |vậy |ok |được |rồi |tiếp|còn lại|thêm|chi tiết|cụ thể hơn|chưa|đã |nữa|tiếp tục)/i.test(t)) return true;
  if (/tiền nhà|điện nước|nợ thẻ|trả góp|thu nhập phụ|đã trả|chưa trả|phân bổ.*thế nào|chia.*thế nào/i.test(t)) return true;
  // Câu rất ngắn + không có chủ ngữ rõ mới coi là follow-up (ví dụ "còn 2 tuần thì sao?", "thế còn BTC?")
  if (t.length < 18 && !/(thị trường|btc|eth|vàng|chứng khoán|cổ phiếu|forex|usd)/i.test(t)) return true;
  return false;
}

export function formatTopicMemory(slots: TopicSlot[]): string {
  if (!slots.length) return "";
  return slots
    .map((s) => {
      const bits = [`[${s.topic}]`];
      if (s.symbols.length) bits.push(s.symbols.join("/"));
      if (s.amount_vnd != null) bits.push(`${s.amount_vnd.toLocaleString("vi-VN")}đ`);
      if (s.horizon) bits.push(s.horizon);
      bits.push(`“${s.summary}”`);
      return `- ${bits.join(" · ")}`;
    })
    .join("\n");
}

export function sameTopicFamily(a: TopicKey, b: TopicKey): boolean {
  const family = (k: TopicKey) =>
    k === "personal_finance" || k === "wealth"
      ? "money_life"
      : k === "crypto" || k === "forex" || k === "vn-stock" || k === "commodity"
        ? "market_asset"
        : k;
  return family(a) === family(b);
}
