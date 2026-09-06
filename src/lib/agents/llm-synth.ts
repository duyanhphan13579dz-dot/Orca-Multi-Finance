import "server-only";
import { llmChat, llmConfigured, modelFor } from "../ai/gateway";
import { collectFactNumbers, validateOutput } from "../ai/validate";
import type { AgentRun } from "./agent-types";

/**
 * LLM SYNTHESIS — biên tập narrative cho AgentRun từ structured data.
 *
 * Quy tắc (giống pipeline cũ):
 * 1. Chỉ LLM viết văn bản; con số phải trace về sections[].data (tool contract).
 * 2. validateOutput: số lạ → regenerate 1 lần (temperature thấp) → vẫn lỗi →
 *    GIỮ NGUYÊN narrative deterministic (fallback chính thức).
 * 3. Không dùng khi chưa cấu hình LLM (llmConfigured() false) → deterministic.
 * 4. Nhãn label minh bạch (FACT/DATA-DRIVEN/MODEL-INFERENCE/SCENARIO/OPINION)
 *    được giữ trong prompt — LLM không được trộn nhãn.
 */

export interface SynthesizeOptions {
  question?: string;
  /** injectable để test (mặc định llmChat thật) */
  chat?: typeof llmChat;
  /** injectable để test (mặc định llmConfigured thật) */
  configured?: boolean;
}

const SYS =
  "Bạn là ORCA Financial Analyst (Việt Nam). Viết lại nội dung dưới dạng phân tích tự nhiên, mạch văn mượt: " +
  "thesis → bằng chứng → phân tích → rủi ro → kịch bản → kết luận actionable. " +
  "TUYỆT ĐỐI CHỈ dùng con số có trong dữ liệu cung cấp; không thêm P/E, giá, target, recommendation, tỷ trọng hay bất kỳ số nào không có trong context. " +
  "Nếu dữ liệu thiếu, nêu rõ phần thiếu — không bù bằng phỏng đoán. " +
  "Phân biệt rõ FACT / DATA-DRIVEN / MODEL-INFERENCE / SCENARIO / OPINION. " +
  "Không khuyến nghị mua/bán tuyệt đối; kết thúc bằng dòng 'Nguồn: <nguồn> · <freshness>'.";

export async function synthesizeRun(run: AgentRun, opts: SynthesizeOptions = {}): Promise<AgentRun> {
  if (!(opts.configured ?? llmConfigured())) {
    run.trace.push("llm:not-configured");
    return run;
  }
  const chat = opts.chat ?? llmChat;
  // FACT set = mọi số trong structured data của sections (tool contract)
  const facts = collectFactNumbers(run.sections.map((s) => s.data));
  const context = run.sections
    .map((s) => `[${s.label}${s.unavailable ? " (UNAVAILABLE)" : ""}] ${s.title}:\n${s.body}`)
    .join("\n\n");
  const user = `${opts.question ? `Câu hỏi: ${opts.question}\n\n` : ""}DỮ LIỆU (chỉ được dùng số trong đây):\n${context}`;

  const attempt = (strictNote: string) =>
    chat("analysis", {
      system: `${SYS}\n${strictNote}`,
      user,
      temperature: 0.3,
      maxTokens: 1000,
      timeoutMs: 28_000,
    });

  const first = await attempt("Viết tự nhiên, phong cách analyst VN, giữ đúng các con số trong dữ liệu.");
  if (!first) {
    run.trace.push("llm:no-response");
    return run;
  }
  let val = validateOutput(first.text, facts);
  if (val.ok) return applySynth(run, first.text, first.model, first.latencyMs);

  // regenerate 1 lần với cảnh báo số lạ
  const regen = await attempt(
    `Lần trả lời trước chứa số không có trong dữ liệu (${val.unsupported.slice(0, 5).map((u) => u.raw).join(", ")}). Chỉ trích số trong dữ liệu.`,
  );
  if (!regen) {
    run.trace.push("llm:fallback-deterministic");
    return run;
  }
  val = validateOutput(regen.text, facts);
  if (val.ok) return applySynth(run, regen.text, regen.model, regen.latencyMs, "regenerated");

  // vẫn sai → deterministic là nguồn chính thức
  run.trace.push("llm:fallback-deterministic");
  return run;
}

function applySynth(run: AgentRun, text: string, model: string, latencyMs: number, recovered?: string): AgentRun {
  run.sections.push({
    id: "llm-synthesis",
    title: "Tổng hợp",
    label: "DATA-DRIVEN",
    body: text,
    data: null,
    sources: [`orca-llm:${model}`],
  });
  run.narrative = text;
  run.sources = [...new Set([...run.sources, `orca-llm:${model}`])];
  run.trace.push(`llm:${model}${recovered ? `:${recovered}` : ""}:${latencyMs}ms`);
  return run;
}

export const llmSynthInfo = () => ({
  configured: llmConfigured(),
  analysisModel: modelFor("analysis"),
});
