import "server-only";

/**
 * Tầng 2 — Dataset Builder cho SFT / DPO
 * Chuyển log hội thoại thành JSONL cho LoRA fine-tune Qwen3.8-27b
 */

export interface SftExample {
  system: string;
  user: string;
  assistant: string;
  intent: string;
  persona: string;
  weight?: number;
}

export interface DpoExample {
  prompt: string;
  chosen: string;
  rejected: string;
  intent: string;
}

/**
 * Build SFT examples: mỗi conversation → 1 example
 * Format: { system, user, assistant } — dùng systemFor(persona) đã có trong agent.ts
 */
export function toSftExample(row: {
  question: string;
  answer: string;
  intent: string;
  persona: string;
  context?: Record<string, unknown>;
}): SftExample {
  const systemMap: Record<string, string> = {
    wealth: "Bạn là chuyên gia quản lý gia sản. Trả lời theo khung lớp tài sản.",
    personal_finance: "Bạn là chuyên gia tài chính cá nhân. Trả lời với trần chi/ngày, phong bì tuần.",
    market: "Bạn là chuyên viên ORCA Financial. Chỉ dùng số trong STRUCTURED CONTEXT.",
    crypto: "Bạn là chuyên gia crypto. Phân tích kỹ thuật + futures.",
    default: "Bạn là chuyên viên ORCA Financial.",
  };
  const system = systemMap[row.persona] ?? systemMap[row.intent] ?? systemMap.default;
  const user = row.context
    ? `STRUCTURED CONTEXT:\n${JSON.stringify(row.context, null, 1).slice(0, 4000)}\n\nCâu hỏi: ${row.question}`
    : row.question;
  return { system, user, assistant: row.answer, intent: row.intent, persona: row.persona, weight: 1 };
}

/**
 * Build DPO pairs: cần feedback rating + correctedAnswer
 * chosen = correctedAnswer (human) hoặc answer được vote up
 * rejected = answer gốc bị vote down
 */
export function toDpoExample(row: {
  question: string;
  answer: string;
  correctedAnswer?: string | null;
  rating: number;
}): DpoExample | null {
  if (!row.correctedAnswer && row.rating !== -1) return null;
  const prompt = row.question;
  const chosen = row.correctedAnswer ?? row.answer;
  const rejected = row.rating === -1 ? row.answer : "";
  if (!chosen || !rejected) return null;
  return { prompt, chosen, rejected, intent: "general" };
}

/**
 * Chia dataset thành train/eval/test 80/10/10, cân bằng persona
 */
export function splitDataset<T>(items: T[], seed = 42): { train: T[]; eval: T[]; test: T[] } {
  // shuffle đơn giản
  const arr = [...items];
  let m = arr.length;
  let r = seed;
  const rand = () => { r = (r * 1664525 + 1013904223) % 4294967296; return r / 4294967296; };
  while (m) { const i = Math.floor(rand() * m--); [arr[m], arr[i]] = [arr[i], arr[m]]; }
  const n = arr.length;
  const nTrain = Math.floor(n * 0.8);
  const nEval = Math.floor(n * 0.1);
  return { train: arr.slice(0, nTrain), eval: arr.slice(nTrain, nTrain + nEval), test: arr.slice(nTrain + nEval) };
}

/**
 * Xuất JSONL cho trainer (mỗi dòng 1 JSON)
 */
export function toJsonl(examples: unknown[]): string {
  return examples.map(e => JSON.stringify(e, null, 0)).join("\n");
}

/**
 * Thống kê cân bằng đa ngữ cảnh
 */
export function datasetStats(examples: { intent: string; persona: string }[]) {
  const byIntent: Record<string, number> = {};
  const byPersona: Record<string, number> = {};
  for (const e of examples) {
    byIntent[e.intent] = (byIntent[e.intent] ?? 0) + 1;
    byPersona[e.persona] = (byPersona[e.persona] ?? 0) + 1;
  }
  return { total: examples.length, byIntent, byPersona };
}
