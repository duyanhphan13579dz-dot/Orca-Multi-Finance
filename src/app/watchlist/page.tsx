"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { loadWatchlist, saveWatchlist, type WatchItem } from "@/components/watchlist-button";
import { DEFAULT_VN_WATCHLIST } from "@/lib/vn/master";
import type { CryptoSummary } from "@/lib/services/crypto";
import type { CryptoMarketRow, ForexRow } from "@/lib/types";
import type { ForexMarket } from "@/lib/services/forex";
import { Badge, Chg, fmtNum, Panel, priceDigits } from "@/components/ui";
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";

type CryptoData = { rows: CryptoMarketRow[]; summary: CryptoSummary };

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [input, setInput] = useState("");
  useEffect(() => {
    // VN-first default watchlist when empty
    if (loadWatchlist().length === 0) {
      saveWatchlist(DEFAULT_VN_WATCHLIST.slice(2).map((s, i) => ({ assetType: "stock" as const, symbol: s, addedAt: Date.now() - i })));
    }
    const load = () => setItems(loadWatchlist());
    load();
    window.addEventListener("orca:watchlist", load);
    return () => window.removeEventListener("orca:watchlist", load);
  }, []);

  const { data: crypto } = useApi<CryptoData>("/api/v1/crypto/markets?limit=300", { refreshInterval: 20_000 });
  const { data: forex } = useApi<ForexMarket>("/api/v1/forex/markets", { refreshInterval: 60_000 });

  const cryptoMap = useMemo(() => new Map((crypto?.rows ?? []).map((r) => [r.symbol, r])), [crypto]);
  const forexMap = useMemo(() => new Map((forex?.rows ?? []).map((r) => [r.pair, r])), [forex]);

  const add = () => {
    const raw = input.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
    if (!raw) return;
    let item: WatchItem | null = null;
    if (/USDT$/.test(raw)) item = { assetType: "crypto", symbol: raw, addedAt: Date.now() };
    else if (/^[A-Z]{2,8}$/.test(raw) && cryptoMap.has(`${raw}USDT`)) item = { assetType: "crypto", symbol: `${raw}USDT`, addedAt: Date.now() };
    else if (/^[A-Z]{6}$/.test(raw)) item = { assetType: "forex", symbol: raw, addedAt: Date.now() };
    else if (raw.includes("/")) item = { assetType: "forex", symbol: raw.replace("/", ""), addedAt: Date.now() };
    else item = { assetType: "stock", symbol: raw, addedAt: Date.now() };
    if (items.some((i) => i.symbol === item!.symbol && i.assetType === item!.assetType)) return;
    saveWatchlist([...items, item]);
    setInput("");
  };

  const move = (idx: number, dir: -1 | 1) => {
    const arr = [...items];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    saveWatchlist(arr);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Panel pad={false}>
        <div className="p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold"><Eye className="size-5 text-accent" /> Watchlist của tôi</h1>
          <p className="mt-0.5 text-[12px] text-ink-3">Lưu cục bộ trên trình duyệt; giá cập nhật realtime theo Data Engine (crypto/forex đang hoạt động, cổ phiếu VN chờ VNStock).</p>
          <div className="mt-3 flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="BTC, ETHUSDT, EURUSD, HPG…"
              enterKeyHint="done"
              className="num flex-1 rounded-xl border border-line bg-panel-2 px-3 py-3 text-[15px] uppercase text-ink placeholder:normal-case placeholder:text-ink-3 focus:border-accent/40 md:rounded-md md:py-2 md:text-[13px]"
            />
            <button onClick={add} className="flex items-center gap-1.5 rounded-xl bg-accent px-4 py-3 text-[14px] font-semibold text-white active:scale-95 md:rounded-md md:px-3 md:py-2 md:text-[13px]">
              <Plus className="size-4" /> Thêm
            </button>
          </div>
        </div>
      </Panel>

      <Panel title={`Đang theo dõi (${items.length})`} pad={false}>
        {items.length === 0 ? (
          <div className="p-4 text-[13px] text-ink-3">Chưa có mã nào — thêm mã ở trên hoặc bấm “Theo dõi” tại trang chi tiết tài sản.</div>
        ) : (
          <ul className="divide-y divide-line/50">
            {items.map((it, idx) => {
              const c = it.assetType === "crypto" ? cryptoMap.get(it.symbol) : null;
              const f = it.assetType === "forex" ? forexMap.get(it.symbol) : null;
              const href = it.assetType === "crypto" ? `/crypto/${it.symbol}` : it.assetType === "forex" ? `/forex/${it.symbol}` : it.assetType === "stock" ? `/stocks/${it.symbol}` : "/commodities";
              return (
                <li key={`${it.assetType}-${it.symbol}`} className="row-hover flex items-center gap-2 px-3.5 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => move(idx, -1)} className="text-ink-3 hover:text-ink" aria-label="Lên"><ArrowUp className="size-3" /></button>
                    <button onClick={() => move(idx, 1)} className="text-ink-3 hover:text-ink" aria-label="Xuống"><ArrowDown className="size-3" /></button>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="text-[13px] font-semibold hover:text-accent">{it.symbol}</Link>
                    <span className="ml-2 text-[10px] text-ink-3">{it.assetType === "crypto" ? "Crypto" : it.assetType === "forex" ? "Forex" : it.assetType === "stock" ? "Cổ phiếu VN" : "Hàng hóa"}</span>
                  </div>
                  {c ? (
                    <div className="text-right">
                      <div className="num text-[13px]">{fmtNum(c.price, priceDigits(c.price))}</div>
                      <Chg value={c.changePercent} className="text-[11px]" arrow={false} />
                    </div>
                  ) : f ? (
                    <div className="text-right">
                      <div className="num text-[13px]">{f.price >= 100 ? f.price.toFixed(2) : f.price.toFixed(4)}</div>
                      <Chg value={f.changePercent} className="text-[11px]" arrow={false} />
                    </div>
                  ) : it.assetType === "stock" ? (
                    <Badge tone="warn">chờ VNStock</Badge>
                  ) : (
                    <Badge>tải giá…</Badge>
                  )}
                  <button
                    onClick={() => saveWatchlist(items.filter((x) => !(x.symbol === it.symbol && x.assetType === it.assetType)))}
                    className="ml-1 text-ink-3 hover:text-down"
                    aria-label="Xóa"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
