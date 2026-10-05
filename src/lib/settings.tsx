"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * ORCA Settings System — client store + server persistence.
 * Instant hydration from localStorage (no flash), debounced sync to
 * /api/v1/settings when authenticated, <html> attribute application for
 * theme/density/font-size, and a module-level snapshot for non-hook utils
 * (formatters, hooks).
 */

export interface UserSettings {
  profile: {
    displayName: string;
    avatarStyle: "orca" | "initials-ocean" | "initials-slate" | "initials-amber" | "custom";
    /** Data URL (jpeg) sau khi crop 160px — đồng bộ qua /api/v1/settings khi đăng nhập */
    avatarUrl: string | null;
    language: "vi" | "en";
    timezone: string; // IANA
    region: "vn" | "global";
    /** Giới thiệu ngắn (≤160 ký tự) */
    bio: string;
    /** Kinh nghiệm đầu tư */
    experience: "beginner" | "intermediate" | "advanced";
    /** Khẩu vị rủi ro */
    riskAppetite: "conservative" | "balanced" | "aggressive";
    /** Phong cách giao dịch chủ đạo */
    tradingStyle: "long_term" | "swing" | "day" | "mixed";
    /** Thị trường ưu tiên — ảnh hưởng gợi ý & thứ tự dashboard */
    preferredMarkets: ("stocks" | "crypto" | "forex" | "commodities")[];
  };
  appearance: {
    mode: "navy" | "light" | "system";
    density: "compact" | "normal" | "comfortable";
    fontSize: "sm" | "md" | "lg";
    numberFormat: "en-US" | "vi-VN";
    currency: "USD" | "VND";
  };
  dashboard: {
    widgets: { id: string; visible: boolean; order: number }[];
    defaultAsset: string;
    defaultMarket: "stocks" | "crypto" | "forex" | "commodities";
    defaultTimeframe: "15m" | "1h" | "4h" | "1d";
  };
  realtime: {
    liveUpdates: boolean;
    lowDataMode: boolean;
    refreshSeconds: number;
    autoReconnect: boolean;
    backgroundRefresh: boolean;
  };
  chart: {
    chartType: "candles" | "area" | "line" | "baseline" | "bar";
    volume: boolean;
    grid: boolean;
    crosshairMagnet: boolean;
    logScale: boolean;
    indicators: {
      ema: boolean;
      ma10: boolean;
      ma20: boolean;
      ma50: boolean;
      ma100: boolean;
      ma200: boolean;
      bollinger: boolean;
      vwap: boolean;
      rsi: boolean;
      macd: boolean;
      srLevels: boolean;
    };
    indicatorParams: {
      emaPeriods: [number, number];
      rsiPeriod: number;
      macdFast: number;
      macdSlow: number;
      macdSignal: number;
      bollingerPeriod: number;
      bollingerStdDev: number;
    };
    drawingHorizontals: Record<string, number[]>;
  };
  reports: { serverScheduleVisible: boolean };
  notifications: {
    marketNews: boolean;
    priceAlerts: boolean;
    reportReady: boolean;
    digestMorning: boolean;
    quietHoursEnabled: boolean;
    quietStart: string;
    quietEnd: string;
    backgroundPush: boolean;
  };
  ai: {
    depth: "concise" | "standard" | "deep";
    style: "analyst" | "technical" | "brief";
    language: "vi" | "en";
    riskDisclosure: "standard" | "detailed" | "off";
  };
  trading: {
    stockFeePct: number;
    sellTaxPct: number;
    cryptoFeePct: number;
    includeFeesInPnl: boolean;
  };
  accessibility: { reducedMotion: boolean };
  updatedAt: number;
}

export const DASHBOARD_WIDGETS: { id: string; label: string; hint: string }[] = [
  { id: "pulse", label: "Market Pulse", hint: "Narrative + risk gauge" },
  { id: "movers", label: "Crypto Movers", hint: "Top gainers/losers realtime" },
  { id: "indices", label: "Chỉ số VN", hint: "VN-Index · VN30 · HNX" },
  { id: "forex", label: "Forex", hint: "Cặp chính + USD note" },
  { id: "commodities", label: "Hàng hóa", hint: "Kim loại, năng lượng…" },
  { id: "news", label: "Dòng tin", hint: "RSS realtime multi-feed" },
  { id: "quicklinks", label: "Quick actions", hint: "Agent · Reports · Heatmap" },
];

export const DEFAULT_SETTINGS: UserSettings = {
  profile: {
    displayName: "",
    avatarStyle: "orca",
    avatarUrl: null,
    language: "vi",
    timezone: "Asia/Ho_Chi_Minh",
    region: "vn",
    bio: "",
    experience: "intermediate",
    riskAppetite: "balanced",
    tradingStyle: "swing",
    preferredMarkets: ["stocks", "crypto"],
  },
  appearance: { mode: "navy", density: "normal", fontSize: "md", numberFormat: "en-US", currency: "USD" },
  dashboard: {
    widgets: DASHBOARD_WIDGETS.map((w, i) => ({ id: w.id, visible: true, order: i })),
    defaultAsset: "BTCUSDT",
    defaultMarket: "crypto",
    defaultTimeframe: "1d",
  },
  realtime: { liveUpdates: true, lowDataMode: false, refreshSeconds: 15, autoReconnect: true, backgroundRefresh: true },
  chart: {
    chartType: "candles",
    volume: true,
    grid: true,
    crosshairMagnet: false,
    logScale: false,
    indicators: {
      ema: true,
      ma10: false,
      ma20: false,
      ma50: false,
      ma100: false,
      ma200: false,
      bollinger: false,
      vwap: true,
      rsi: true,
      macd: true,
      srLevels: true,
    },
    indicatorParams: {
      emaPeriods: [20, 50],
      rsiPeriod: 14,
      macdFast: 12,
      macdSlow: 26,
      macdSignal: 9,
      bollingerPeriod: 20,
      bollingerStdDev: 2,
    },
    drawingHorizontals: {},
  },
  reports: { serverScheduleVisible: true },
  notifications: {
    marketNews: true,
    priceAlerts: true,
    reportReady: true,
    digestMorning: false,
    quietHoursEnabled: false,
    quietStart: "22:00",
    quietEnd: "07:00",
    backgroundPush: true,
  },
  ai: { depth: "standard", style: "analyst", language: "vi", riskDisclosure: "standard" },
  trading: {
    stockFeePct: 0.15,
    sellTaxPct: 0.1,
    cryptoFeePct: 0.1,
    includeFeesInPnl: true,
  },
  accessibility: { reducedMotion: false },
  updatedAt: 0,
};

const KEY = "orca.settings.v1";
const FONT_MAP = { sm: "14px", md: "15px", lg: "16px" } as const;

type SettingsCtxValue = {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => void;
  reset: () => void;
};

const SettingsCtx = createContext<SettingsCtxValue | null>(null);

let snapshot: UserSettings = DEFAULT_SETTINGS;
let loggedIn = false;
const listeners = new Set<() => void>();
let syncTimer: ReturnType<typeof setTimeout> | null = null;

function mergeDeep(base: UserSettings, patch: Partial<UserSettings>): UserSettings {
  const out = { ...base } as UserSettings;
  for (const k of Object.keys(patch) as (keyof UserSettings)[]) {
    const pv = patch[k];
    if (pv && typeof pv === "object" && !Array.isArray(pv) && k !== "updatedAt") {
      // @ts-expect-error structural merge
      out[k] = { ...(base[k] as object), ...(pv as object) };
    } else if (pv !== undefined) {
      // @ts-expect-error structural merge
      out[k] = pv;
    }
  }
  return out;
}

function persistLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode / quota */
  }
}

function scheduleServerSync() {
  if (!loggedIn) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    void fetch("/api/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: snapshot }),
    }).catch(() => {});
  }, 700);
}

function notify() {
  for (const l of listeners) l();
}

function applyHtmlAttrs(s: UserSettings) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  const mode =
    s.appearance.mode === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "navy"
      : s.appearance.mode;
  el.dataset.theme = mode;
  el.dataset.density = s.appearance.density;
  el.style.fontSize = FONT_MAP[s.appearance.fontSize];
  el.lang = s.profile.language;
  const prefersReduced =
    typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.dataset.reducedMotion = s.accessibility.reducedMotion || prefersReduced ? "true" : "false";
}

function hydrateFromLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    snapshot = mergeDeep(DEFAULT_SETTINGS, parsed);
  } catch {
    /* ignore */
  }
}

export function getSettingsSnapshot(): UserSettings {
  return snapshot;
}

export function updateSettings(patch: Partial<UserSettings>) {
  snapshot = mergeDeep(snapshot, { ...patch, updatedAt: Date.now() });
  persistLocal();
  applyHtmlAttrs(snapshot);
  scheduleServerSync();
  notify();
}

export function setLoggedInFlag(v: boolean) {
  loggedIn = v;
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const boot = useRef(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (boot.current) return;
    boot.current = true;
    hydrateFromLocal();
    applyHtmlAttrs(snapshot);
    notify();
    void fetch("/api/v1/auth/me")
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && j?.data?.user) {
          loggedIn = true;
          return fetch("/api/v1/settings")
            .then((r) => r.json())
            .then((s) => {
              if (s?.ok && s?.data?.settings) {
                snapshot = mergeDeep(DEFAULT_SETTINGS, s.data.settings as Partial<UserSettings>);
                persistLocal();
                applyHtmlAttrs(snapshot);
                notify();
              }
            });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const update = useCallback((patch: Partial<UserSettings>) => {
    updateSettings(patch);
  }, []);

  const reset = useCallback(() => {
    snapshot = { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
    persistLocal();
    applyHtmlAttrs(snapshot);
    scheduleServerSync();
    notify();
  }, []);

  const value = useMemo<SettingsCtxValue>(
    () => ({ settings: snapshot, update, reset }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick drives refresh via setTick in listener
    [update, reset, snapshot.updatedAt],
  );

  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): SettingsCtxValue {
  const ctx = useContext(SettingsCtx);
  if (ctx) return ctx;
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return {
    settings: snapshot,
    update: updateSettings,
    reset: () => {
      snapshot = { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
      persistLocal();
      applyHtmlAttrs(snapshot);
      scheduleServerSync();
      notify();
    },
  };
}

export function resolveRefresh(baseMs: number | undefined): number {
  const s = snapshot.realtime;
  if (!s.liveUpdates) return Math.max(baseMs ?? 60_000, 60_000);
  if (s.lowDataMode) return Math.max(baseMs ?? 30_000, 30_000);
  const sec = s.refreshSeconds || 15;
  return Math.max(sec * 1000, baseMs ?? 0);
}

/** Quiet hours check — dùng cho mọi monitor đẩy Notification/Webhook phía client. */
export function isQuietHoursNow(): boolean {
  const n = snapshot.notifications;
  if (!n.quietHoursEnabled) return false;
  const parse = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map((x) => Number(x) || 0);
    return h * 60 + m;
  };
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = parse(n.quietStart);
  const end = parse(n.quietEnd);
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

export function tradeFeePct(
  assetType: "stock" | "crypto" | "forex" | "commodity",
  side: "long" | "short",
): number {
  if (assetType === "stock") {
    const t = snapshot.trading;
    const fee = t.stockFeePct;
    const tax = side === "short" ? 0 : t.sellTaxPct;
    return fee + tax;
  }
  if (assetType === "crypto") return snapshot.trading.cryptoFeePct;
  return 0;
}

export function tradeFeesValue(
  assetType: "stock" | "crypto" | "forex" | "commodity",
  side: "long" | "short",
  entry: number,
  exit: number | null,
  size: number | null,
  leverage: number | null,
): number {
  if (!snapshot.trading.includeFeesInPnl) return 0;
  const notional = entry * (size ?? 1) * (leverage ?? 1);
  const feePct = tradeFeePct(assetType, side) / 100;
  return notional * feePct + (exit != null ? exit * (size ?? 1) * (leverage ?? 1) * feePct : 0);
}

export function useSettingsContext(): SettingsCtxValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettingsContext outside provider");
  return ctx;
}
