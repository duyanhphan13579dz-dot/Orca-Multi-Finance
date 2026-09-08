import "server-only";

/**
 * Pipeline tổng hợp 4 tầng huấn luyện
 * Tầng 1: Prompt/Memory (runtime, đã hotfix)
 * Tầng 2: Data Collection → SFT Dataset
 * Tầng 3: RAG Index
 * Tầng 4: Eval + DPO
 */

export interface PipelineStep {
  name: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
  count?: number;
}

export async function runTier2_DatasetBuild(limit = 500) {
  const { fetchTrainingLogs } = await import("./collector");
  const { toSftExample, splitDataset, toJsonl, datasetStats } = await import("./dataset");
  const logs = await fetchTrainingLogs({ limit, sinceDays: 30 });
  const examples = logs.map(r => toSftExample({ question: r.question, answer: r.answer, intent: r.intent ?? "general", persona: r.persona ?? "stock_analyst", context: r.context as Record<string, unknown> }));
  const stats = datasetStats(examples);
  const { train, eval: ev, test } = splitDataset(examples);
  return {
    stats,
    trainCount: train.length,
    evalCount: ev.length,
    testCount: test.length,
    trainJsonl: toJsonl(train).slice(0, 4000), // preview
  };
}

export async function runTier3_RagIndex() {
  const { buildMarketSnapshot } = await import("../../services/market");
  const { indexMarketSnapshot, indexNews, ragStore } = await import("./rag");
  const snap = await buildMarketSnapshot().catch(() => null);
  let n = 0;
  if (snap) n += await indexMarketSnapshot({ headline: snap.snapshot.pulse.headline, body: snap.snapshot.pulse.body });
  if (snap?.snapshot.news) n += await indexNews(snap.snapshot.news.slice(0, 10).map(n => ({ title: n.title, summary: n.summary, source: n.source, publishedAt: n.publishedAt, id: n.id })));
  return { indexed: n, total: ragStore.count() };
}

export async function runTier4_Eval() {
  const { DEFAULT_EVAL_SET, runEval } = await import("./eval");
  const { answerQuestion } = await import("../../services/agent");
  const result = await runEval(DEFAULT_EVAL_SET, async (q) => {
    const { result } = await answerQuestion(q, {}, []);
    return { intent: result.intent, answer: result.answer, latencyMs: 0 };
  });
  return result;
}

export async function trainingStatus(): Promise<{ tiers: PipelineStep[]; llm: { model: string; configured: boolean } }> {
  const { llmRegistryInfo } = await import("../gateway");
  const { ragStore } = await import("./rag");
  const info = llmRegistryInfo();
  return {
    llm: { model: info.models.reasoning, configured: info.configured },
    tiers: [
      { name: "Tầng 1 — Prompt & Memory (runtime)", status: "done", detail: "isFollowUpCue hotfix + few-shot market/BTC + persona separation" },
      { name: "Tầng 2 — Data Collection (DB log)", status: "done", detail: "agent_conversations + agent_feedback, fetchTrainingLogs" },
      { name: "Tầng 2b — SFT Dataset (JSONL 80/10/10)", status: "pending", detail: "toSftExample, split, toJsonl" },
      { name: "Tầng 3 — RAG (in-memory PGVector-ready)", status: "done", detail: `chunks: ${ragStore.count()}`, count: ragStore.count() },
      { name: "Tầng 4 — Eval harness (intent/hallucination)", status: "done", detail: "DEFAULT_EVAL_SET 7 cases, runEval" },
      { name: "Tầng 4b — DPO/RLHF (feedback loop)", status: "pending", detail: "agent_feedback → DPO pairs" },
      { name: "Tầng 5 — LoRA fine-tune qwen3-32b 128K", status: "pending", detail: "scripts/train-llm/sft.py (cần GPU, max_seq 4096)" },
    ],
  };
}
