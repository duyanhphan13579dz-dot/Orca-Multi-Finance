"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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
    refreshSeconds: number; // 5 | 10 | 15 | 30 | 60
    autoReconnect: boolean;
    backgroundRefresh: boolean;
  };
  chart: {
    chartType: "candles" | "area" | "line" | "baseline" | "bar";
    volume: boolean;
    grid: boolean;
    crosshairMagnet: boolean;
    logScale: boolean;
    indicators: { ema: boolean; ma10: boolean; ma20: boolean; ma50: boolean; ma100: boolean; ma200: boolean; bollinger: boolean; vwap: boolean; rsi: boolean; macd: boolean; srLevels: boolean };
    /** Tham số chỉ báo tùy chỉnh (chuẩn TradingView-style per-indicator settings) */
    indicatorParams: {
      emaPeriods: [number, number]; // fast/slow, mặc định 20/50
      rsiPeriod: number; // mặc định 14
      macdFast: number; // 12
      macdSlow: number; // 26
      macdSignal: number; // 9
      bollingerPeriod: number; // 20
      bollingerStdDev: number; // 2
    };
    /** Nhớ các đường ngang user vẽ theo symbol (per-symbol persistence) */
    drawingHorizontals: Record<string, number[]>;
  };
  reports: {
    /** Server-controlled schedule (REPORT_MORNING_TIME env) — chỉ đọc để hiển thị; chỉnh trên server */
    serverScheduleVisible: boolean;
  };
  notifications: {
    marketNews: boolean;
    priceAlerts: boolean;
    reportReady: boolean;
    digestMorning: boolean;
    /** Quiet hours — tắt push/webhook trong khung này (chuẩn trading platform) */
    quietHoursEnabled: boolean;
    quietStart: string; // HH:mm
    quietEnd: string; // HH:mm
    /** Chỉ khi tab nền cũng được phép đẩy Notification */
    backgroundPush: boolean;
  };
  ai: {
    depth: "concise" | "standard" | "deep";
    style: "analyst" | "technical" | "brief";
    language: "vi" | "en";
    riskDisclosure: "standard" | "detailed" | "off";
  };
  /** Nhóm Giao dịch & Phí — dùng chung cho Trade Journal / Portfolio PnL */
  trading: {
    stockFeePct: number; // phí GD CK VN, % mỗi chiều (mặc định 0.15)
    sellTaxPct: number; // thuế bán CK, % giá trị bán (mặc định 0.1)
    cryptoFeePct: number; // phí Binance spot/taker, % (mặc định 0.1)
    includeFeesInPnl: boolean; // cộng phí vào PnL khi tính (mặc định true)
  };
  /** Accessibility — tôn trọng prefers-reduced-motion + override thủ công */
  accessibility: {
    reducedMotion: boolean;
  };
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
  },
  appearance: { mode: "navy", density: "normal", fontSize: "md", numberFormat: "en-US", currency: "USD" },
  dashboard: {
    widgets: DASHBOARD_WIDGETS.map((w, i) => ({ id: w.id, visible: true, order: i })),
    defaultAsset: "BTCUSDT",
    defaultMarket: "crypto",
    defaultTimeframe: "1h",
  },
  realtime: { liveUpdates: true, lowDataMode: false, refreshSeconds: 15, autoReconnect: true, backgroundRefresh: true },
  // realtime.autoReconnect + backgroundRefresh đang được xử lý tự động phía client
  // (SWR visibility + reconnect built-in) — giữ field cho backward-compat, không còn UI toggle.
  chart: {
    chartType: "candles",
    volume: true,
    grid: true,
    crosshairMagnet: false,
    logScale: false,
    indicators: { ema: true, ma10: false, ma20: false, ma50: false, ma100: false, ma200: false, bollinger: false, vwap: true, rsi: true, macd: true, srLevels: true },
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
  // Accessibility: reduced motion tôn trọng prefers-reduced-motion của OS + override thủ công
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

type SettingsCtxValue = {
  settings: UserSettings;
  update: (patch: Partial<UserSettings>) => void;
  reset: () => void;
};

const SettingsCtx = createContext<SettingsCtxValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const value = useSettings();
  return <SettingsCtx.Provider value={value}>{children}</SettingsCtx.Provider>;
}

export function useSettings(): SettingsCtxValue {
  const [, setTick] = useState(0);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!hydrated.current) {
      hydrateFromLocal();
      applyHtmlAttrs(snapshot);
      hydrated.current = true;
      setTick((t) => t + 1);
    }
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/v1/auth/me");
        if (!res.ok) {
          setLoggedInFlag(false);
          return;
        }
        setLoggedInFlag(true);
        const setRes = await fetch("/api/v1/settings");
        if (!setRes.ok || cancelled) return;
        const json = (await setRes.json()) as { data?: { settings?: Partial<UserSettings> | null } };
        const remote = json?.data?.settings;
        if (remote && !cancelled) {
          snapshot = mergeDeep(snapshot, remote);
          persistLocal();
          applyHtmlAttrs(snapshot);
          notify();
        }
      } catch {
        /* offline */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (patch: Partial<UserSettings>) => {
    updateSettings(patch);
  };

  const reset = () => {
    snapshot = { ...DEFAULT_SETTINGS, updatedAt: Date.now() };
    persistLocal();
    applyHtmlAttrs(snapshot);
    scheduleServerSync();
    notify();
  };

  return { settings: snapshot, update, reset };
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
  // Khung qua nửa đêm (22:00 → 07:00)
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
}

/**
 * Phí giao dịch tổng cho một lệnh — dùng chung Journal/Portfolio.
 * feePct truyền vào là phần trăm (0.15 = 0.15%).
 */
export function tradeFeePct(assetType: "stock" | "crypto" | "forex" | "commodity", side: "long" | "short"): number {
  const t = snapshot.trading;
  if (assetType === "stock") {
    const fee = t.stockFeePct;
    const tax = side === "short" ? 0 : t.sellTaxPct; // short VN không có thuế bán thực tế
    return fee + tax;
  }
  if (assetType === "crypto") return t.cryptoFeePct;
  return 0;
}

/** Phí tổng (đơn vị giá trị) cho lệnh entry→exit. Bỏ qua nếu user tắt includeFees. */
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
  // Entry luôn mất phí; exit mất phí khi đã đóng (mua/bán đều mất phí ở cả 2 chiều)
  return notional * feePct + (exit != null ? exit * (size ?? 1) * (leverage ?? 1) * feePct : 0);
}

export function useSettingsContext(): SettingsCtxValue {
  const ctx = useContext(SettingsCtx);
  if (!ctx) throw new Error("useSettingsContext outside provider");
  return ctx;
}
