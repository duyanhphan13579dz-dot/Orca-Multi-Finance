/** Multi-topic conversation memory helpers for ORCA Agent. */

export type TopicKey =
  | "personal_finance"
  | "wealth"
  | "crypto"
  | "forex"
  | "vn-stock"
  | "vn-market"
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
  const t = q.trim();
  return (
    t.length < 56 ||
    /^(thế |còn |và |với |nếu |vậy |ok |được |rồi |tiếp|còn lại|thêm|chi tiết|cụ thể hơn|chưa|đã )/i.test(t) ||
    /tiền nhà|điện nước|nợ thẻ|trả góp|thu nhập phụ|đã trả|chưa trả/i.test(t)
  );
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
      : k === "crypto" || k === "forex" || k === "vn-stock" || k === "vn-market" || k === "commodity"
        ? "market_asset"
        : k;
  return family(a) === family(b);
}
