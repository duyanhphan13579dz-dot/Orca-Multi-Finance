"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import { clientCacheGet, clientCacheSet } from "@/lib/client-cache";
import type { MarketSnapshot } from "@/lib/services/market";
import type { ApiResponse } from "@/lib/types";

const SNAP_URL = "/api/v1/market/snapshot";
const SS_KEY = "orca:ticker:snap:v1";

const REGION_ORDER: Array<MarketSnapshot["indices"][number]["region"]> = [
  "vn",
  "asia",
  "us",
  "forex",
];

const REGION_DOT: Record<string, string> = {
  vn: "bg-accent-primary",
  asia: "bg-warning",
  us: "bg-positive",
  forex: "bg-accent-2",
};

/** Module sticky — survives remount when chuyển trang trong SPA. */
let stickySnap: MarketSnapshot | null = null;

function readSessionSnap(): MarketSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; snap: MarketSnapshot };
    if (Date.now() - parsed.at > 30 * 60_000) return null;
    if (!parsed.snap?.indices?.length) return null;
    return parsed.snap;
  } catch {
    return null;
  }
}

function writeSessionSnap(snap: MarketSnapshot) {
  if (typeof window === "undefined") return;
  if (!snap?.indices?.length) return;
  stickySnap = snap;
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify({ at: Date.now(), snap }));
  } catch {
    /* quota */
  }
}

function pickSnap(live: MarketSnapshot | null | undefined): MarketSnapshot | null {
  if (live?.indices?.length) {
    writeSessionSnap(live);
    return live;
  }
  if (stickySnap?.indices?.length) return stickySnap;
  return readSessionSnap();
}

/** Prefetch snapshot early — call from providers on boot. */
export function prefetchMarketSnapshot() {
  if (typeof window === "undefined") return;
  if (clientCacheGet(SNAP_URL, 45_000)) return;
  void fetch(SNAP_URL, { headers: { Accept: "application/json" }, cache: "no-store" })
    .then((r) => r.json())
    .then((json: ApiResponse<MarketSnapshot>) => {
      if (json?.success && json.data) {
        clientCacheSet(SNAP_URL, json);
        if (json.data.indices?.length) writeSessionSnap(json.data);
      }
    })
    .catch(() => undefined);
}

/** Realtime ticker — cố định, sticky data khi chuyển trang. */
export const TickerTape = memo(function TickerTape() {
  const { data, isLoading } = useApi<MarketSnapshot>(SNAP_URL, {
    refreshInterval: 40_000,
    timeoutMs: 12_000,
  });
  const trackRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [seed] = useState<MarketSnapshot | null>(() => stickySnap ?? readSessionSnap());

  useEffect(() => {
    prefetchMarketSnapshot();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const el = trackRef.current?.parentElement;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setPaused(!entry.isIntersecting), {
      threshold: 0.05,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const snap = pickSnap(data) ?? seed;
  if (data?.indices?.length) writeSessionSnap(data);

  const items = useMemo(() => {
    const result: {
      key: string;
      label: string;
      href: string;
      price: number;
      chg: number | null;
      digits: number;
      region: string;
    }[] = [];

    const rows = snap?.indices ?? [];
    const byRegion = (r: string) => rows.filter((i) => i.region === r);

    const budgets: Record<string, number> = narrow
      ? { vn: 3, asia: 2, us: 2, forex: 2 }
      : { vn: 5, asia: 4, us: 4, forex: 4 };

    for (const region of REGION_ORDER) {
      const slice = byRegion(region).slice(0, budgets[region] ?? 3);
      for (const i of slice) {
        if (!Number.isFinite(i.value)) continue;
        const digits = region === "forex" ? (i.value >= 100 ? 2 : 4) : 2;
        result.push({
          key: `${region}-${i.code}`,
          label: i.label || i.code,
          href: i.href || "/market",
          price: i.value,
          chg: i.changePercent,
          digits,
          region,
        });
      }
    }

    if (!narrow && snap?.global?.cryptoTip?.length) {
      for (const c of snap.global.cryptoTip.slice(0, 2)) {
        if (!Number.isFinite(c.price)) continue;
        result.push({
          key: `crypto-${c.symbol}`,
          label: c.symbol,
          href: `/crypto/${c.symbol}USDT`,
          price: c.price,
          chg: c.changePercent,
          digits: c.price >= 100 ? 2 : 4,
          region: "crypto",
        });
      }
    }

    return result;
  }, [snap, narrow]);

  if (!items.length) {
    return (
      <div className="ticker-bar sticky top-0 z-30 flex h-8 items-center px-4 text-[11px] text-ink-3">
        <span className="size-1.5 animate-pulse rounded-full bg-accent/60" />
        <span className="ml-2">
          {isLoading
            ? "Đang kết nối luồng dữ liệu thị trường…"
            : "Đang tải chỉ số VN · Châu Á · Mỹ · Forex…"}
        </span>
      </div>
    );
  }

  const loop = [...items, ...items];
  return (
    <div className="ticker-bar sticky top-0 z-30 h-8">
      <div
        ref={trackRef}
        className={`ticker-track ${paused ? "is-paused" : ""}`}
        aria-label="Băng chỉ số thị trường"
      >
        {loop.map((it, i) => (
          <Link
            key={`${it.key}-${i}`}
            href={it.href}
            className="num mx-3 flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-2 transition-colors hover:text-ink sm:mx-4 sm:text-[12px]"
          >
            <span
              className={`inline-block size-1.5 shrink-0 rounded-full ${REGION_DOT[it.region] ?? "bg-ink-3"}`}
              aria-hidden
            />
            <span className="font-medium text-ink">{it.label}</span>
            <span>
              {it.price.toLocaleString("en-US", {
                minimumFractionDigits: it.digits,
                maximumFractionDigits: it.digits,
              })}
            </span>
            {it.chg != null && Number.isFinite(it.chg) && (
              <span className={it.chg >= 0 ? "text-up" : "text-down"}>
                {it.chg >= 0 ? "▲" : "▼"} {Math.abs(it.chg).toFixed(2)}%
              </span>
            )}
          </Link>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 z-[1] w-8 bg-gradient-to-r from-[var(--color-canvas)] to-transparent sm:w-10" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-[1] w-8 bg-gradient-to-l from-[var(--color-canvas)] to-transparent sm:w-10" />
    </div>
  );
});
