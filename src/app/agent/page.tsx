"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, ShieldCheck } from "lucide-react";
import type { ApiResponse, Meta } from "@/lib/types";
import { Badge, Panel } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { AuthGate } from "@/components/auth-gate";

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

const MAX_HISTORY = 8;

export default function AgentPage() {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "agent",
      text: "Chào bạn — mình là ORCA Agent. Có thể hỏi về thị trường, cổ phiếu, hoặc tài chính cá nhân / gia sản. Mình nhớ ngữ cảnh trong phiên trò chuyện này.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Msg[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);

    // Build history from prior turns (exclude the brand-new user message)
    const prior = messagesRef.current
      .filter((m) => m.text?.trim())
      // skip pure greeting if it is the only prior agent line
      .slice(-MAX_HISTORY)
      .map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text.slice(0, 2_500),
      }));

    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    try {
      const res = await fetch("/api/v1/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history: prior,
          preferences: settings.ai,
        }),
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
    <AuthGate feature="AI Agent" description="Trợ lý ORCA nhớ ngữ cảnh, phân tích thị trường & tài chính cá nhân — cần đăng nhập để lưu lịch sử và tránh lạm dụng AI.">
      <div className="mx-auto flex max-w-3xl flex-col gap-3 pb-2">
      <Panel pad={false}>
        <div className="flex items-center justify-between gap-3 p-4">
          <div>
            <h1 className="flex items-center gap-2 text-[17px] font-semibold md:text-lg">
              <Bot className="size-5 text-accent" /> ORCA Financial Agent
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] md:text-[12px] text-ink-3">
              <ShieldCheck className="size-3.5 text-up" /> Nhớ ngữ cảnh phiên · Thị trường · Tài chính cá nhân · Gia sản
            </p>
          </div>
          <Badge tone="accent">multi-persona</Badge>
        </div>
      </Panel>

      <div ref={listRef} className="panel max-h-[62dvh] space-y-3 overflow-y-auto overscroll-contain p-3 md:max-h-[56dvh] md:p-3.5" style={{ WebkitOverflowScrolling: "touch" }}>
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[86%] rounded-2xl border px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm md:max-w-[88%] ${
                m.role === "user" ? "border-accent/30 bg-accent/10 text-ink rounded-br-sm" : "border-line bg-panel-2 text-ink rounded-bl-sm"
              }`}
            >
              <div className="whitespace-pre-wrap break-words">{m.text}</div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Đang phân tích…
          </div>
        )}
      </div>

      <div className="scrollbar-hide chip-scroll -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
        {SUGGESTED.map((s) => (
          <button key={s} onClick={() => ask(s)} disabled={busy} className="scroll-snap-item shrink-0 whitespace-nowrap rounded-full border border-line bg-panel px-3 py-1.5 text-[11px] font-medium text-ink-2 active:bg-accent/10 active:text-accent hover:border-accent/40 hover:text-accent disabled:opacity-50 md:py-1">
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="agent-composer -mx-3 flex items-end gap-2 border-t border-line/50 bg-background-primary/90 px-3 pt-3 backdrop-blur md:mx-0 md:border-0 md:bg-transparent md:px-0 md:pt-0 md:backdrop-blur-none"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Hỏi tiếp trong cùng ngữ cảnh, hoặc đổi chủ đề bất kỳ lúc nào…"
          enterKeyHint="send"
          className="min-h-[46px] flex-1 rounded-2xl border border-line bg-panel px-4 py-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-accent/40 focus:outline-none md:rounded-lg md:px-3.5 md:py-2.5 md:text-[13px]"
        />
        <button type="submit" disabled={busy || !input.trim()} className="grid size-[46px] shrink-0 place-items-center rounded-2xl bg-accent px-0 text-white shadow-sm active:scale-95 disabled:opacity-50 md:h-auto md:w-auto md:rounded-lg md:px-3.5 md:py-2.5 md:text-[13px] md:font-semibold">
          <CornerDownLeft className="size-5 md:size-4" />
          <span className="hidden md:inline md:ml-1">Gửi</span>
        </button>
      </form>
      </div>
    </AuthGate>
  );
}
