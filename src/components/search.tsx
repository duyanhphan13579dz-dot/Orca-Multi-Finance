"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@/lib/hooks";
import { getSettingsSnapshot } from "@/lib/settings";
import { searchSecurities, VN_INDICES, sectorOf } from "@/lib/vn/master";
import { looksLikeVnTicker } from "@/lib/vn/ipo-seeds";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { CryptoMarketRow } from "@/lib/types";
import { CandlestickChart, Coins, Home, ListTree, Search as SearchIcon, TrendingUp } from "lucide-react";

/**
 * VIETNAM-FIRST SEARCH — static master + live VNDirect universe (IPO mới).
 */

interface Item {
  key: string;
  label: string;
  sub: string;
  href: string;
  icon: React.ReactNode;
  rank: number;
}

const STATIC_ITEMS: Item[] = [
  { key: "idx-vnindex", label: "VN-INDEX", sub: "Chỉ số HOSE · VN Market Center", href: "/stocks", icon: <ListTree className="size-3.5" />, rank: 95 },
  { key: "idx-vn30", label: "VN30", sub: "Chỉ số VN30 · HOSE", href: "/stocks", icon: <ListTree className="size-3.5" />, rank: 94 },
  { key: "idx-hnxindex", label: "HNX-INDEX", sub: "Chỉ số HNX", href: "/stocks", icon: <ListTree className="size-3.5" />, rank: 93 },
  { key: "idx-upcom", label: "UPCOM-INDEX", sub: "Chỉ số UPCoM", href: "/stocks", icon: <ListTree className="size-3.5" />, rank: 92 },
  { key: "r-home", label: "Tổng quan", sub: "VN Market Center", href: "/", icon: <Home className="size-3.5" />, rank: 40 },
  { key: "r-agent", label: "AI Agent", sub: "Phân tích chứng khoán VN", href: "/agent", icon: <TrendingUp className="size-3.5" />, rank: 35 },
  ...["EURUSD", "USDJPY", "GBPUSD", "USDVND"].map((p) => ({
    key: `fx-${p}`, label: p, sub: "Forex", href: `/forex/${p}`, icon: <Coins className="size-3.5" />, rank: 10,
  })),
];

type MarketsData = { rows: CryptoMarketRow[]; summary: CryptoSummary };

type LiveSearchData = {
  q: string;
  count: number;
  items: {
    symbol: string;
    name: string | null;
    exchange: string | null;
    industry: string | null;
    listedDate: string | null;
    source: string;
  }[];
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { data } = useApi<MarketsData>(open ? "/api/v1/crypto/markets?limit=300" : null, { refreshInterval: 0 });

  // Live search — universe + IPO + lookup VNDirect
  const liveUrl =
    open && q.trim().length >= 1
      ? `/api/v1/search?q=${encodeURIComponent(q.trim())}&limit=12`
      : null;
  const { data: live } = useApi<LiveSearchData>(liveUrl, { refreshInterval: 0 });

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [];
    const needle = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

    // 1) Live VN hits (ưu tiên — gồm HPA/VCK/VPX/TCX/DMX)
    for (const hit of live?.items ?? []) {
      const isNew = hit.source === "seed" || hit.source === "lookup" || Boolean(hit.listedDate);
      all.push({
        key: `vn-${hit.symbol}`,
        label: hit.symbol,
        sub: [
          hit.name ?? "Cổ phiếu VN",
          hit.exchange,
          hit.industry,
          hit.listedDate ? `NY ${hit.listedDate}` : null,
          isNew && hit.source !== "static" ? "mới" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        href: `/stocks/${hit.symbol}`,
        icon: <CandlestickChart className="size-3.5" />,
        rank: hit.symbol === needle ? 100 : 85,
      });
    }

    // 2) Static fallback nếu live chưa về
    if (!(live?.items?.length) && q.trim()) {
      for (const sec of searchSecurities(q, 10)) {
        all.push({
          key: `vn-${sec.symbol}`,
          label: sec.symbol,
          sub: `${sec.name} · ${sec.exchange} · ${sec.sector}`,
          href: `/stocks/${sec.symbol}`,
          icon: <CandlestickChart className="size-3.5" />,
          rank: sec.bluechip ? 88 : 82,
        });
      }
      // Exact ticker shape → vẫn cho vào /stocks/XXX
      if (looksLikeVnTicker(needle) && !all.some((i) => i.label === needle)) {
        all.unshift({
          key: `vn-direct-${needle}`,
          label: needle,
          sub: "Mở trang cổ phiếu (lookup VNDirect)",
          href: `/stocks/${needle}`,
          icon: <CandlestickChart className="size-3.5" />,
          rank: 99,
        });
      }
    }

    if (!q.trim()) {
      for (const idx of VN_INDICES.slice(0, 3)) {
        all.push({
          key: `hn-${idx.code}`,
          label: idx.name,
          sub: `Chỉ số ${idx.exchange}`,
          href: "/stocks",
          icon: <ListTree className="size-3.5" />,
          rank: 93,
        });
      }
    }

    // crypto
    for (const r of (data?.rows ?? []).slice(0, 60)) {
      const match =
        q.trim() && (r.symbol.includes(q.toUpperCase()) || r.baseAsset.includes(q.toUpperCase()));
      if (!q.trim() || match) {
        all.push({
          key: `c-${r.symbol}`,
          label: r.baseAsset,
          sub: `Crypto · ${
            r.changePercent != null
              ? (r.changePercent >= 0 ? "+" : "") + r.changePercent.toFixed(2) + "%"
              : ""
          }`,
          href: `/crypto/${r.symbol}`,
          icon: <Coins className="size-3.5" />,
          rank: q.trim() && r.baseAsset === q.trim().toUpperCase() ? 70 : 20,
        });
      }
    }

    const staticHits = STATIC_ITEMS.filter(
      (i) =>
        !needle ||
        i.label.toUpperCase().includes(needle) ||
        i.sub.toUpperCase().includes(needle),
    );
    const merged = [...all, ...staticHits];
    const uniq = new Map<string, Item>();
    for (const it of merged) if (!uniq.has(it.href + it.label)) uniq.set(it.href + it.label, it);
    return [...uniq.values()]
      .sort((a, b) => {
        if (needle) {
          if (a.label === needle && a.key.startsWith("vn-")) return -1;
          if (b.label === needle && b.key.startsWith("vn-")) return 1;
        }
        return b.rank - a.rank;
      })
      .slice(0, 12);
  }, [q, data, live]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const id = window.setTimeout(() => setSel(0), 0);
    return () => window.clearTimeout(id);
  }, [items.length]);

  const go = (item?: Item) => {
    const target = item ?? items[sel] ?? null;
    if (!target) {
      const raw = q.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (looksLikeVnTicker(raw)) {
        router.push(`/stocks/${raw}`);
      } else {
        const def = getSettingsSnapshot().dashboard.defaultAsset;
        router.push(`/crypto/${def}`);
      }
    } else {
      router.push(target.href);
    }
    setOpen(false);
    setQ("");
  };

  return (
    <div className="relative w-full max-w-sm">
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-border-subtle bg-surface-elevated px-3 py-1.5 text-[12px] text-text-muted transition-colors hover:border-border-default"
        aria-label="Tìm kiếm (Ctrl+K)"
      >
        <SearchIcon className="size-3.5" />
        <span className="hidden sm:block">HPA, TCX, VCK, HPG, BTC…</span>
        <kbd className="ml-auto hidden rounded border border-border-subtle px-1 text-[10px] sm:block">Ctrl K</kbd>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[2px]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 right-0 top-0 z-50 mt-1 overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5">
              <SearchIcon className="size-4 text-text-muted" />
              <input
                ref={inputRef}
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSel((s) => Math.min(s + 1, items.length - 1));
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSel((s) => Math.max(s - 1, 0));
                  }
                  if (e.key === "Enter") {
                    e.preventDefault();
                    go();
                  }
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder="Mã CP (HPA, TCX…), tên công ty, crypto, forex…"
                className="w-full bg-transparent text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {items.length === 0 && (
                <li className="px-3 py-3 text-[12px] text-text-muted">
                  Không có kết quả — Enter mở mã nếu đúng dạng ticker VN.
                </li>
              )}
              {items.map((it, i) => (
                <li key={it.key + i}>
                  <button
                    onMouseEnter={() => setSel(i)}
                    onClick={() => go(it)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                      i === sel ? "bg-accent-primary/12" : ""
                    }`}
                  >
                    <span className="grid size-7 place-items-center rounded-md border border-border-subtle bg-surface-elevated text-text-secondary">
                      {it.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-primary">
                        {it.label}
                        {it.key.startsWith("vn-") && (
                          <span className="rounded bg-accent-primary/15 px-1 text-[9px] font-semibold text-accent-primary">
                            VN{sectorOf(it.label) !== "Khác" ? "" : ""}
                          </span>
                        )}
                      </span>
                      <span className="block truncate text-[11px] text-text-muted">{it.sub}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
