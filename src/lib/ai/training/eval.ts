import "server-only";

/**
 * Tầng 4 — Đánh giá đa ngữ cảnh (Eval harness)
 * Đo: intent accuracy, hallucination rate, persona consistency, latency
 */

export interface EvalExample {
  question: string;
  expectedIntent: string;
  expectedPersona?: string;
  mustContain?: string[]; // từ khóa bắt buộc trong answer
  mustNotHallucinate?: boolean;
}

export interface EvalResult {
  intentAccuracy: number;
  hallucinationRate: number;
  avgLatencyMs: number;
  perPersona: Record<string, { count: number; acc: number }>;
  failures: { question: string; expected: string; got: string; answer: string }[];
}

export async function runEval(
  examples: EvalExample[],
  answerFn: (q: string) => Promise<{ intent: string; answer: string; latencyMs?: number }>
): Promise<EvalResult> {
  let correct = 0;
  let halluc = 0;
  let latencySum = 0;
  const perPersona: Record<string, { count: number; correct: number }> = {};
  const failures: EvalResult["failures"] = [];

  // dynamic import để tránh circular
  const { validateOutput, collectFactNumbers } = await import("../validate");

  for (const ex of examples) {
    const t0 = performance.now();
    const res = await answerFn(ex.question);
    const latency = res.latencyMs ?? Math.round(performance.now() - t0);
    latencySum += latency;

    const intentOk = res.intent === ex.expectedIntent;
    if (intentOk) correct++; else failures.push({ question: ex.question, expected: ex.expectedIntent, got: res.intent, answer: res.answer.slice(0, 400) });

    const per = perPersona[ex.expectedPersona ?? ex.expectedIntent] ?? (perPersona[ex.expectedPersona ?? ex.expectedIntent] = { count: 0, correct: 0 });
    per.count++; if (intentOk) per.correct++;

    if (ex.mustContain) {
      for (const kw of ex.mustContain) if (!res.answer.includes(kw)) failures.push({ question: ex.question, expected: `contain:${kw}`, got: "missing", answer: res.answer.slice(0, 400) });
    }
    if (ex.mustNotHallucinate) {
      // hallucination check: nếu answer có số mà không trong question thì coi như cần validate
      const { validateOutput: v } = await import("../validate");
      const facts = new Set<number>();
      // facts rỗng → mọi số >10 sẽ bị coi unsupported → đơn giản hoá: chỉ check có số lạ không
      const val = v(res.answer, facts);
      if (!val.ok) halluc++;
    }
  }

  const perPersonaAcc: Record<string, { count: number; acc: number }> = {};
  for (const [k, v] of Object.entries(perPersona)) perPersonaAcc[k] = { count: v.count, acc: v.count ? v.correct / v.count : 0 };

  return {
    intentAccuracy: examples.length ? correct / examples.length : 0,
    hallucinationRate: examples.length ? halluc / examples.length : 0,
    avgLatencyMs: examples.length ? Math.round(latencySum / examples.length) : 0,
    perPersona: perPersonaAcc,
    failures: failures.slice(0, 20),
  };
}

/**
 * Bộ eval mặc định — bao phủ 4 ngữ cảnh chính trong ảnh user
 */
export const DEFAULT_EVAL_SET: EvalExample[] = [
  { question: "Thị trường đang diễn ra chuyện gì?", expectedIntent: "market", expectedPersona: "stock_analyst", mustContain: ["Thị trường", "pulse"], mustNotHallucinate: true },
  { question: "Phân tích BTC hiện tại", expectedIntent: "crypto", expectedPersona: "stock_analyst", mustContain: ["BTC"], mustNotHallucinate: true },
  { question: "Còn 5tr sống 30 ngày chia sao?", expectedIntent: "personal_finance", expectedPersona: "personal_finance", mustContain: ["5.000.000"], mustNotHallucinate: true },
  { question: "100tr phân bổ gia sản thế nào?", expectedIntent: "wealth", expectedPersona: "wealth", mustContain: ["100"], mustNotHallucinate: true },
  { question: "VNINDEX hôm nay bao nhiêu?", expectedIntent: "vn-stock", expectedPersona: "stock_analyst" },
  { question: "So sánh BTC và ETH", expectedIntent: "compare" },
  { question: "Thị trường đang diễn ra chuyện gì? và BTC sao?", expectedIntent: "market", expectedPersona: "stock_analyst" }, // đa ngữ cảnh
];
