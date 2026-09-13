"use client";

/**
 * ORCA Agent — chat frame.
 *
 * Layout: the transcript is plain document flow (the window scrolls), so a long
 * answer is always fully readable and the panel's own background + bottom edge
 * ("chân") stay visible after the last message. The composer is sticky to the
 * viewport bottom so it never disappears while reading. An anchor is scrolled
 * into view as turns arrive; the anchor carries scroll-margin so it stops above
 * the sticky composer instead of under it.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, ShieldCheck, Square, Trash2, TriangleAlert } from "lucide-react";
import type { ApiResponse } from "@/lib/types";
import { Badge, Panel } from "@/components/ui";
import { useSettings } from "@/lib/settings";
import { ChatMessage } from "@/components/agent/chat-message";
import { chatStore, nextTurnId, useChatStore } from "@/lib/ai/chat-store";

interface AgentResult {
  answer: string;
  mode: "deterministic" | "llm";
  intent: string;
  persona?: string;
  model: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dataQuality: "HIGH" | "MEDIUM" | "LOW";
  dataFreshness: string;
  context: { sectionsUsed: string[]; symbols: string[] };
}

const SUGGESTED = [
  "Thị trường đang diễn ra chuyện gì?",
  "Phân tích cổ phiếu FPT",
  "Phân tích BTC hiện tại",
  "Giá vàng thế giới và vàng SJC hôm nay thế nào?",
  "EUR/USD đang có xu hướng gì?",
  "Tin tức đáng chú ý gần đây",
];

/** Turns replayed to the agent as context (the route itself keeps the last 20). */
const MAX_HISTORY = 8;
/** Hard limit mirrors the API (`question.length > 800` → 400). */
const MAX_CHARS = 800;
/** Per-turn context cap, same as the route. */
const MAX_TURN_CHARS = 2_500;

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function TypingIndicator({ elapsed }: { elapsed: number }) {
  return (
    <div className="flex items-end gap-2" aria-hidden>
      <span className="mb-1 grid size-6 shrink-0 place-items-center rounded-md border border-accent/30 bg-accent/10">
        <span className="size-1.5 animate-ping rounded-full bg-accent" />
      </span>
      <div className="rounded-lg rounded-bl-sm border border-line bg-panel-2 px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-16 animate-pulse rounded-full bg-line-2" />
          <span className="h-1.5 w-24 animate-pulse rounded-full bg-line-2 [animation-delay:120ms]" />
          <span className="h-1.5 w-10 animate-pulse rounded-full bg-line-2 [animation-delay:240ms]" />
        </div>
        <span className="num mt-1.5 block text-[10px] text-ink-3">
          Đang phân tích dữ liệu…{elapsed > 0 ? ` ${elapsed}s` : ""}
        </span>
      </div>
    </div>
  );
}

export default function AgentPage() {
  const { settings } = useSettings();
  const { messages, input } = useChatStore();
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<{ message: string; question: string } | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);

  /* keep the newest turn in view as it lands (window scroll, not a nested box) */
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "end" });
  }, [messages.length, busy]);

  /* live timer while a request is in flight */
  useEffect(() => {
    if (!busy) return;
    const t0 = Date.now();
    const iv = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => window.clearInterval(iv);
  }, [busy]);

  /* grow the composer with the question, capped */
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`;
  }, [input]);

  /* never leave a request in flight when the page unmounts */
  useEffect(() => () => abortRef.current?.abort(), []);

  const ask = useCallback(
    async (raw: string) => {
      const question = raw.trim().slice(0, MAX_CHARS);
      if (question.length < 3 || busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setElapsed(0);
      setError(null);

      const history = chatStore
        .contextTurns()
        .slice(-MAX_HISTORY)
        .map((t) => ({
          role: t.role === "user" ? ("user" as const) : ("assistant" as const),
          content: t.text.slice(0, MAX_TURN_CHARS),
        }));

      chatStore.push({ id: nextTurnId(), role: "user", text: question, ts: Date.now() });
      chatStore.setInput("");

      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const res = await fetch("/api/v1/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, history, preferences: settings.ai }),
          signal: ctrl.signal,
        });
        const json = (await res.json().catch(() => null)) as ApiResponse<AgentResult> | null;
        if (!json) throw new Error(res.ok ? "Phản hồi không hợp lệ từ agent." : `Máy chủ trả về lỗi ${res.status}.`);
        if (!json.success) throw new Error(json.error.message);
        const d = json.data;
        chatStore.push({
          id: nextTurnId(),
          role: "agent",
          text: d.answer,
          ts: Date.now(),
          meta: {
            mode: d.mode,
            persona: d.persona,
            model: d.model,
            confidence: d.confidence,
            dataQuality: d.dataQuality,
            dataFreshness: d.dataFreshness,
            symbols: d.context?.symbols,
            sectionsUsed: d.context?.sectionsUsed,
          },
        });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          chatStore.push({ id: nextTurnId(), role: "agent", text: "Đã dừng câu trả lời.", ts: Date.now(), system: true, context: false });
        } else {
          // Errors stay out of the transcript so they are never replayed as context.
          setError({ message: e instanceof Error ? e.message : "Không kết nối được tới agent.", question });
        }
      } finally {
        busyRef.current = false;
        abortRef.current = null;
        setBusy(false);
      }
    },
    [settings.ai],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const clearChat = useCallback(() => {
    abortRef.current?.abort();
    busyRef.current = false;
    setBusy(false);
    setError(null);
    chatStore.reset();
    taRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
      e.preventDefault();
      if (!busyRef.current) void ask(input);
    },
    [ask, input],
  );

  const fresh = messages.length <= 1;
  const remaining = MAX_CHARS - input.length;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2">
      <Panel pad={false}>
        <div className="flex items-center justify-between gap-3 p-3 sm:p-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-[15px] font-semibold sm:text-lg">
              <Bot className="size-5 shrink-0 text-accent" /> ORCA Financial Agent
            </h1>
            <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-ink-3 sm:text-[12px]">
              <ShieldCheck className="size-3.5 shrink-0 text-up" />
              <span className="truncate">Nhớ ngữ cảnh phiên · Thị trường · Tài chính cá nhân · Gia sản</span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={clearChat}
              disabled={busy}
              aria-label="Bắt đầu cuộc trò chuyện mới"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[11px] text-ink-2 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40"
            >
              <Trash2 className="size-3.5" />
              <span className="hidden sm:inline">Mới</span>
            </button>
            <Badge tone="accent">multi-persona</Badge>
          </div>
        </div>
      </Panel>

      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={busy}
        aria-label="Nội dung trò chuyện với ORCA Agent"
        className="panel space-y-3 p-3 pb-4 sm:p-3.5 sm:pb-5"
      >
        {messages.map((turn) => (
          <ChatMessage key={turn.id} turn={turn} />
        ))}
        {busy && <TypingIndicator elapsed={elapsed} />}
        <div ref={endRef} className="h-px scroll-mb-40" />
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-[12px] text-down">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="break-words">{error.message}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">Câu hỏi chưa được ghi vào ngữ cảnh — bạn có thể thử lại ngay.</p>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <button
              type="button"
              onClick={() => {
                const q = error.question;
                setError(null);
                void ask(q);
              }}
              disabled={busy}
              className="rounded-md border border-down/40 px-2 py-1 text-[11px] font-medium text-down hover:bg-down/15 disabled:opacity-40"
            >
              Thử lại
            </button>
            <button type="button" onClick={() => setError(null)} className="rounded-md px-1.5 py-1 text-[11px] text-ink-3 hover:text-ink">
              Bỏ qua
            </button>
          </div>
        </div>
      )}

      {fresh && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {SUGGESTED.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => void ask(s)}
              disabled={busy}
              className="shrink-0 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] whitespace-nowrap text-ink-2 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50"
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
        className="panel sticky bottom-2 z-20 flex items-end gap-2 p-2 shadow-xl shadow-canvas/60"
      >
        <label htmlFor="orca-agent-input" className="sr-only">
          Câu hỏi cho ORCA Agent
        </label>
        <textarea
          id="orca-agent-input"
          ref={taRef}
          rows={1}
          value={input}
          onChange={(e) => chatStore.setInput(e.target.value.slice(0, MAX_CHARS))}
          onKeyDown={onKeyDown}
          placeholder="Hỏi tiếp trong cùng ngữ cảnh, hoặc đổi chủ đề bất kỳ lúc nào…"
          className="max-h-[132px] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
        />
        <div className="flex shrink-0 items-center gap-2 pb-0.5">
          {input.length > MAX_CHARS * 0.8 && <span className={`num text-[10px] ${remaining < 0 ? "text-down" : "text-ink-3"}`}>{remaining}</span>}
          {busy ? (
            <button
              type="button"
              onClick={stop}
              aria-label="Dừng trả lời"
              className="flex items-center gap-1.5 rounded-lg border border-down/40 bg-down/10 px-3 py-2 text-[13px] font-semibold text-down transition-colors hover:bg-down/20"
            >
              <Square className="size-3.5" /> Dừng
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-accent/90 px-3.5 py-2 text-[13px] font-semibold text-canvas transition-colors hover:bg-accent disabled:opacity-40"
            >
              <CornerDownLeft className="size-4" /> Gửi
            </button>
          )}
        </div>
      </form>

      <p className="px-1 text-[10px] text-ink-3">
        Enter để gửi · Shift+Enter xuống dòng · tối đa {MAX_CHARS} ký tự
      </p>
    </div>
  );
}
