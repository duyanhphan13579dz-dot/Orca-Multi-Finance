/**
 * Session-scoped chat store for the ORCA Agent frame.
 *
 * Mirrors the shape of src/lib/settings.tsx: a module-level snapshot plus a
 * listener set, consumed through `useSyncExternalStore`. Keeping the transcript
 * outside component state means (a) hydration stays clean — the server snapshot
 * is always the empty state and the restored conversation arrives through the
 * store after mount, (b) there is no ref-mirroring of state for history
 * building, and (c) writes persist themselves.
 */

import { useSyncExternalStore } from "react";

export interface ChatTurnMeta {
  mode?: "deterministic" | "llm";
  persona?: string;
  model?: string | null;
  confidence?: string;
  dataQuality?: string;
  dataFreshness?: string;
  symbols?: string[];
  sectionsUsed?: string[];
}

export interface ChatTurn {
  id: string;
  role: "user" | "agent";
  text: string;
  ts: number;
  /** System notices (e.g. "stopped") — rendered but never replayed as context. */
  system?: boolean;
  /** Set false to keep a turn out of the context window sent back to the agent. */
  context?: boolean;
  meta?: ChatTurnMeta;
}

export interface ChatSnapshot {
  messages: ChatTurn[];
  input: string;
}

const KEY = "orca.agent.chat.v2";
/** Turns kept in memory / sessionStorage. */
export const MAX_STORED = 40;

const GREETING =
  "Chào bạn — mình là ORCA Agent. Có thể hỏi về thị trường, cổ phiếu, hoặc tài chính cá nhân / gia sản. Mình nhớ ngữ cảnh trong phiên trò chuyện này.";

export const GREETING_ID = "greet";

let seq = 0;
export function nextTurnId(): string {
  return `m${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function greetingTurn(): ChatTurn {
  return { id: GREETING_ID, role: "agent", text: GREETING, ts: Date.now(), context: false };
}

const EMPTY: ChatSnapshot = { messages: [], input: "" };

let snapshot: ChatSnapshot = EMPTY;
let loaded = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

function isTurn(v: unknown): v is ChatTurn {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Partial<ChatTurn>;
  return (t.role === "user" || t.role === "agent") && typeof t.text === "string" && t.text.length > 0;
}

function readStored(): ChatSnapshot | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: unknown; input?: unknown };
    const messages = Array.isArray(parsed.messages) ? parsed.messages.filter(isTurn).slice(-MAX_STORED) : [];
    const input = typeof parsed.input === "string" ? parsed.input.slice(0, 800) : "";
    if (messages.length === 0 && !input) return null;
    return { messages, input };
  } catch {
    return null;
  }
}

/** First client access hydrates from sessionStorage; the greeting fills an empty session. */
function load() {
  if (loaded) return;
  loaded = true;
  const stored = readStored();
  snapshot = stored
    ? { messages: stored.messages.length > 0 ? stored.messages : [greetingTurn()], input: stored.input }
    : { messages: [greetingTurn()], input: "" };
}

function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      window.sessionStorage.setItem(
        KEY,
        JSON.stringify({
          messages: snapshot.messages.filter((m) => !m.system && m.id !== GREETING_ID).slice(-MAX_STORED),
          input: snapshot.input,
        }),
      );
    } catch {
      /* private mode / quota — chat keeps working, it just is not restored */
    }
  }, 400);
}

function commit(next: ChatSnapshot) {
  snapshot = next;
  notify();
  persist();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export const chatStore = {
  subscribe,
  /** Client snapshot — hydrates lazily on first read. */
  getSnapshot(): ChatSnapshot {
    load();
    return snapshot;
  },
  /** Server snapshot — stable empty state so SSR/prerender never mismatches. */
  getServerSnapshot(): ChatSnapshot {
    return EMPTY;
  },
  /** Turns replayed as agent context (greeting and system notices excluded). */
  contextTurns(): ChatTurn[] {
    load();
    return snapshot.messages.filter((m) => m.context !== false && !m.system && m.text.trim().length > 0);
  },
  push(turn: ChatTurn) {
    load();
    commit({ ...snapshot, messages: [...snapshot.messages, turn].slice(-MAX_STORED) });
  },
  setInput(input: string) {
    load();
    if (input === snapshot.input) return;
    commit({ ...snapshot, input });
  },
  reset() {
    commit({ messages: [greetingTurn()], input: "" });
  },
};

/** Hook form of the store for the chat frame. */
export function useChatStore(): ChatSnapshot {
  return useSyncExternalStore(chatStore.subscribe, chatStore.getSnapshot, chatStore.getServerSnapshot);
}
