"use client";

/**
 * Single chat turn of the ORCA Agent frame.
 *
 * Memoised on purpose: the composer re-renders on every keystroke, and without
 * this the whole transcript (plus its per-message markdown parse) would be
 * rebuilt each time. Answer text is rendered through the pure block parser,
 * so rich formatting costs one parse per answer, not one per render.
 */

import { memo, useMemo, useState } from "react";
import { Bot, Check, Copy } from "lucide-react";
import { Badge } from "@/components/ui";
import { blockText, parseChatBlocks, type ChatBlock, type ChatInline } from "@/lib/ai/chat-format";
import type { ChatTurn, ChatTurnMeta } from "@/lib/ai/chat-store";

export type { ChatTurn, ChatTurnMeta };

const PERSONA_LABEL: Record<string, string> = {
  stock_analyst: "Phân tích",
  personal_finance: "Tài chính cá nhân",
  wealth: "Gia sản",
};

const LEVEL_TONE: Record<string, "up" | "warn" | "down"> = { HIGH: "up", MEDIUM: "warn", LOW: "down" };

export function clockLabel(ts: number): string {
  try {
    return new Date(ts).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" });
  } catch {
    return "";
  }
}

function Inline({ parts }: { parts: ChatInline[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.bold ? (
          <strong key={i} className="font-semibold text-ink">
            {p.text}
          </strong>
        ) : p.code ? (
          <code key={i} className="rounded bg-panel-3/70 px-1 py-px text-[12px] text-accent-2">
            {p.text}
          </code>
        ) : (
          // plain runs stay bare strings — no wrapper node per text run
          p.text
        ),
      )}
    </>
  );
}

function Block({ block }: { block: ChatBlock }) {
  switch (block.type) {
    case "heading":
      return (
        <h3 className="mt-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-accent first:mt-0">
          <Inline parts={block.inline} />
        </h3>
      );
    case "bullet":
      return (
        <div className="flex gap-1.5">
          <span aria-hidden className="mt-px shrink-0 select-none text-accent/70">
            {block.marker}
          </span>
          <span className="min-w-0">
            <Inline parts={block.inline} />
          </span>
        </div>
      );
    case "quote":
      return (
        <div className="border-l-2 border-line-2 pl-2 text-ink-2 italic">
          <Inline parts={block.inline} />
        </div>
      );
    case "gap":
      return <div className="h-1.5" />;
    default:
      return (
        <p>
          <Inline parts={block.inline} />
        </p>
      );
  }
}

function MetaRow({ meta }: { meta: ChatTurnMeta }) {
  const tone = (v?: string) => (v ? (LEVEL_TONE[v] ?? "neutral") : "neutral");
  const symbols = meta.symbols ?? [];
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line/60 pt-1.5">
      {meta.mode === "llm" ? (
        <Badge tone="accent">{meta.model ? `LLM · ${meta.model}` : "LLM"}</Badge>
      ) : (
        <Badge tone="neutral">engine</Badge>
      )}
      {meta.persona && <Badge tone="neutral">{PERSONA_LABEL[meta.persona] ?? meta.persona}</Badge>}
      {meta.confidence && <Badge tone={tone(meta.confidence)}>tin cậy {meta.confidence}</Badge>}
      {meta.dataQuality && <Badge tone={tone(meta.dataQuality)}>dữ liệu {meta.dataQuality}</Badge>}
      {meta.dataFreshness && <Badge tone={meta.dataFreshness === "LIVE" || meta.dataFreshness === "FRESH" ? "up" : "warn"}>{meta.dataFreshness}</Badge>}
      {symbols.slice(0, 4).map((s) => (
        <Badge key={s} tone="neutral">
          <span className="num">{s}</span>
        </Badge>
      ))}
      {symbols.length > 4 && <Badge tone="neutral">+{symbols.length - 4}</Badge>}
      {(meta.sectionsUsed?.length ?? 0) > 0 && (
        <span className="text-[10px] text-ink-3" title={`Nguồn ngữ cảnh: ${(meta.sectionsUsed ?? []).join(", ")}`}>
          {meta.sectionsUsed!.length} nguồn
        </span>
      )}
    </div>
  );
}

export const ChatMessage = memo(function ChatMessage({ turn }: { turn: ChatTurn }) {
  const [copied, setCopied] = useState(false);
  const isUser = turn.role === "user";
  const blocks = useMemo(() => (isUser ? [] : parseChatBlocks(turn.text)), [isUser, turn.text]);
  const hasMeta = !isUser && turn.meta != null && !turn.system;

  async function copy() {
    const text = blocks.length > 0 ? blocks.map(blockText).filter(Boolean).join("\n") : turn.text;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`group flex items-end gap-2 ${isUser ? "flex-row-reverse" : ""}`}>
      {!isUser && (
        <span aria-hidden className="mb-1 grid size-6 shrink-0 place-items-center rounded-md border border-accent/30 bg-accent/10 text-accent">
          <Bot className="size-3.5" />
        </span>
      )}
      <div className={`min-w-0 max-w-[88%] sm:max-w-[80%] ${isUser ? "text-right" : ""}`}>
        <div
          className={`rounded-lg border px-3 py-2 text-[13px] leading-relaxed ${
            isUser
              ? "rounded-br-sm border-accent/30 bg-accent/10 text-ink"
              : turn.system
                ? "border-line bg-panel-2/60 text-ink-3 italic"
                : "rounded-bl-sm border-line bg-panel-2 text-ink break-words [overflow-wrap:anywhere]"
          }`}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap break-words">{turn.text}</span>
          ) : (
            <div className="space-y-1">
              {blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>
          )}
        </div>

        {hasMeta && <MetaRow meta={turn.meta!} />}

        <div className={`mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-3 ${isUser ? "justify-end" : ""}`}>
          <time dateTime={new Date(turn.ts).toISOString()}>{clockLabel(turn.ts)}</time>
          {!isUser && !turn.system && (
            <button
              type="button"
              onClick={() => void copy()}
              aria-label={copied ? "Đã sao chép" : "Sao chép câu trả lời"}
              className="inline-flex items-center gap-1 rounded px-1 py-0.5 opacity-0 transition-opacity hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
            >
              {copied ? <Check className="size-3 text-up" /> : <Copy className="size-3" />}
              {copied ? "Đã chép" : "Chép"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
