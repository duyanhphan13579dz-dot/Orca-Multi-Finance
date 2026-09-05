"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export interface WatchItem {
  assetType: "stock" | "crypto" | "forex" | "commodity";
  symbol: string;
  addedAt: number;
}

const KEY = "orca.watchlist.v1";

export function loadWatchlist(): WatchItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as WatchItem[];
  } catch {
    return [];
  }
}

export function saveWatchlist(items: WatchItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("orca:watchlist"));
}

export function AddToWatchlist({ assetType, symbol }: { assetType: WatchItem["assetType"]; symbol: string }) {
  const [has, setHas] = useState(false);
  useEffect(() => {
    const check = () => setHas(loadWatchlist().some((i) => i.symbol === symbol && i.assetType === assetType));
    check();
    window.addEventListener("orca:watchlist", check);
    return () => window.removeEventListener("orca:watchlist", check);
  }, [assetType, symbol]);

  return (
    <button
      onClick={() => {
        const items = loadWatchlist();
        if (has) saveWatchlist(items.filter((i) => !(i.symbol === symbol && i.assetType === assetType)));
        else saveWatchlist([...items, { assetType, symbol, addedAt: Date.now() }]);
      }}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
        has ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-ink-3 hover:border-line-2 hover:text-ink"
      }`}
      title={has ? "Xóa khỏi watchlist" : "Thêm vào watchlist"}
    >
      {has ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
      {has ? "Đang theo dõi" : "Theo dõi"}
    </button>
  );
}
