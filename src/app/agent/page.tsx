"use client";

import { useRef, useState } from "react";
import { Bot, CornerDownLeft, ShieldCheck } from "lucide-react";
import type { ApiResponse, Meta } from "@/lib/types";
import { Badge, FreshnessDot, Panel } from "@/components/ui";
import { useSettings } from "@/lib/settings";

interface AgentResult {
  answer: string;
  mode: "deterministic" | "llm";
  intent: string;
  model: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  dataFreshness: string;
  context: { sectionsUsed: string[]; symbols: string[] };
}

interface Msg {
  role: "user" | "agent";
  text: string;
  meta?: Meta | null;
  mode?: string;
  intent?: string;
  confidence?: string;
  dataQuality?: string;
  model?: string | null;
}

const SUGGESTED = [
  "Thị trường đang diễn ra chuyện gì?",
  "Phân tích BTC hiện tại",
  "ETH có đang mạnh hơn BTC không? So sánh giúp",
  "Giá vàng thế giới và vàng SJC hôm nay thế nào?",
  "EUR/USD đang có xu hướng gì?",
  "Tin tức đáng chú ý gần đây",
];

export default function AgentPage() {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "agent",
      text: "Chào bạn — mình là ORCA Agent. Nguyên tắc làm việc: truy xuất dữ liệu thật trước (Binance, ngoại hối, hàng hóa, tin tức…), sau đó mới lập luận. Mình không dùng dữ liệu cũ từ mô hình và sẽ nói rõ khi một nguồn dữ liệu chưa khả dụng (ví dụ VNStock đang chờ API key).",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    try {
      const res = await fetch("/api/v1/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, preferences: settings.ai }),
      });
      const json = (await res.json()) as ApiResponse<AgentResult>;
      if (json.success) {
        setMessages((m) => [
          ...m,
          {
            role: "agent",
            text: json.data.answer,
            meta: json.meta,
            mode: json.data.mode,
            intent: json.data.intent,
            confidence: json.data.confidence,
            dataQuality: json.data.dataQuality,
            model: json.data.model,
          },
        ]);
      } else {
        setMessages((m) => [...m, { role: "agent", text: `Không xử lý được: ${json.error.message}` }]);
      }
    } catch {
      setMessages((m) => [...m, { role: "agent", text: "Kết nối tới agent thất bại — thử lại sau." }]);
    } finally {
      setBusy(false);
      setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }), 60);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <Panel pad={false}>
        <div className="flex items-center justify-between gap-3 p-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Bot className="size-5 text-accent" /> ORCA Financial Agent
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              <ShieldCheck className="size-3.5 text-up" /> Fetch data first → reason second · Chống hallucination bằng structured context
            </p>
          </div>
          <Badge tone="accent">multi-asset</Badge>
        </div>
      </Panel>

      <div ref={listRef} className="panel max-h-[56dvh] space-y-3 overflow-y-auto p-3.5">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[88%] rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed ${
                m.role === "user" ? "border-accent/30 bg-accent/10 text-ink" : "border-line bg-panel-2 text-ink"
              }`}
            >
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.meta && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line/60 pt-1.5 text-[10px] text-ink-3">
                  <FreshnessDot status={m.meta.freshness} ageMs={m.meta.ageMs} />
                  <span>engine: {m.mode === "llm" ? `LLM${m.model ? ` · ${m.model}` : ""} (bounded)` : "deterministic"}</span>
                  {m.confidence && (
                    <span className={m.confidence === "HIGH" ? "text-up" : m.confidence === "MEDIUM" ? "text-warn" : "text-down"}>
                      confidence {m.confidence}
                    </span>
                  )}
                  {m.dataQuality && <span>quality {m.dataQuality}</span>}
                  {m.intent && <span>intent: {m.intent}</span>}
                  {m.meta.outputValidation && (
                    <span className={m.meta.outputValidation.validated ? "text-up" : "text-warn"}>
                      output {m.meta.outputValidation.validated ? "validated" : `recovered${m.meta.outputValidation.recovered ? `: ${m.meta.outputValidation.recovered}` : ""}`}
                    </span>
                  )}
                  {m.meta.note && <span>{m.meta.note}</span>}
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Đang truy xuất dữ liệu thị trường & phân tích…
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SUGGESTED.map((s) => (
          <button key={s} onClick={() => ask(s)} disabled={busy} className="rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Hỏi về thị trường: BTC, EUR/USD, vàng, bức tranh chung…"
          className="flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent/40"
        />
        <button type="submit" disabled={busy || !input.trim()} className="flex items-center gap-1.5 rounded-lg bg-accent/90 px-3.5 py-2.5 text-[13px] font-semibold text-canvas hover:bg-accent disabled:opacity-50">
          <CornerDownLeft className="size-4" /> Gửi
        </button>
      </form>
    </div>
  );
}
