"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, ShieldCheck } from "lucide-react";
import type { ApiResponse, Meta } from "@/lib/types";
import { Badge, Panel } from "@/components/ui";
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
  "Phân tích cổ phiếu FPT",
  "Phân tích BTC hiện tại",
  "ETH có đang mạnh hơn BTC không? So sánh giúp",
  "Giá vàng thế giới và vàng SJC hôm nay thế nào?",
  "EUR/USD đang có xu hướng gì?",
  "Tin tức đáng chú ý gần đây",
];

const MAX_HISTORY = 8;

function renderInline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

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
  const bottomRef = useRef<HTMLDivElement>(null);

  function renderAnswer(text: string) {
    return text.split("\n").map((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("## ")) {
        return (
          <h3 key={index} className="mt-3 text-sm font-semibold text-accent first:mt-0">
            {trimmed.slice(3)}
          </h3>
        );
      }
      if (/^[-•] /.test(trimmed)) {
        return (
          <div key={index} className="ml-3 break-words">
            {renderInline(trimmed)}
          </div>
        );
      }
      if (!trimmed) return <div key={index} className="h-2" />;
      return (
        <p key={index} className="break-words">
          {renderInline(line)}
        </p>
      );
    });
  }

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [messages, busy]);

  async function ask(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    setBusy(true);

    const prior = messagesRef.current
      .filter((m) => m.text?.trim())
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
    }
  }

  const showSuggestions = messages.length <= 2;

  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-2"
      style={{
        height: "calc(100dvh - 9.5rem)",
        maxHeight: "calc(100dvh - 9.5rem)",
        minHeight: 0,
      }}
    >
      <Panel pad={false} className="shrink-0">
        <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
              <Bot className="size-5 shrink-0 text-accent" /> ORCA Financial Agent
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-ink-3 sm:text-[12px]">
              <ShieldCheck className="size-3.5 shrink-0 text-up" /> Nhớ ngữ cảnh phiên · Thị trường · Tài chính cá nhân · Gia sản
            </p>
          </div>
          <Badge tone="accent">multi-persona</Badge>
        </div>
      </Panel>

      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain rounded-xl border border-line bg-panel p-3 sm:p-3.5"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`rounded-lg border px-3.5 py-2.5 text-[13px] leading-relaxed ${
                m.role === "user"
                  ? "max-w-[min(100%,28rem)] border-accent/30 bg-accent/10 text-ink"
                  : "w-full max-w-full border-line bg-panel-2 text-ink"
              }`}
            >
              <div className="space-y-1.5 break-words [overflow-wrap:anywhere] [word-break:break-word]">
                {m.role === "agent" ? renderAnswer(m.text) : m.text}
              </div>
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-ink-3">
            <span className="size-1.5 animate-pulse rounded-full bg-accent" /> Đang phân tích…
          </div>
        )}
        <div ref={bottomRef} className="h-3 shrink-0" aria-hidden />
      </div>

      <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-line bg-canvas px-2.5 pb-2 pt-2 shadow-[0_-4px_16px_rgba(0,0,0,0.25)]">
        {showSuggestions && (
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SUGGESTED.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                disabled={busy}
                className="shrink-0 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-ink-2 hover:border-accent/40 hover:text-accent disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
        )}

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
            placeholder="Hỏi tiếp trong cùng ngữ cảnh, hoặc đổi chủ đề bất kỳ lúc nào…"
            maxLength={800}
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3.5 py-2.5 text-[13px] text-ink placeholder:text-ink-3 focus:border-accent/40"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent/90 px-3.5 py-2.5 text-[13px] font-semibold text-canvas hover:bg-accent disabled:opacity-50"
          >
            <CornerDownLeft className="size-4" /> Gửi
          </button>
        </form>
        <p className="text-center text-[10px] text-ink-3">
          Enter để gửi · tối đa 800 ký tự · ORCA nghiên cứu — không phải khuyến nghị
        </p>
      </div>
    </div>
  );
}
