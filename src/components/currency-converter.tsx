"use client";

import { useMemo, useState } from "react";
import { useApi } from "@/lib/hooks";
import { fmtNum, MetaLine } from "@/components/ui";
import { ArrowRightLeft } from "lucide-react";

/**
 * MÁY TÍNH QUY ĐỔI TIỀN TỆ — trang /commodities.
 * Nhập số tiền + chọn tiền nguồn → quy đổi sang mọi loại tiền khác.
 * Nguồn: USD→VND VietnamBiz khi có; cặp khác exchangerate-api.
 */

export interface FxRatesData {
  base: string;
  currencies: { code: string; label: string }[];
  rates: Record<string, number>;
  usdVndVietnamBiz: { rate: number; indicator: string; period: string | null } | null;
  source: string;
  timestamp: string | null;
}

export function useFxRates() {
  const { data, meta, isLoading } = useApi<FxRatesData>("/api/v1/commodities/fx", { refreshInterval: 120_000 });
  return { rates: data ?? null, meta, isLoading };
}

/** convert thuần phía client; trả null khi thiếu rate. */
export function convertClient(amount: number, from: string, to: string, rates: Record<string, number>): number | null {
  if (!Number.isFinite(amount) || amount < 0) return null;
  const rf = rates[from];
  const rt = rates[to];
  if (rf == null || rt == null || !Number.isFinite(rf) || !Number.isFinite(rt) || rf <= 0 || rt <= 0) return null;
  return (amount * rt) / rf;
}

export function CurrencyConverter({ className }: { className?: string }) {
  const { rates: data, meta, isLoading } = useFxRates();
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState("USD");

  const currencies = useMemo(() => data?.currencies ?? ([] as FxRatesData["currencies"]), [data]);
  const rates = useMemo(() => data?.rates ?? ({} as Record<string, number>), [data]);
  const amountNum = Number(amount.replace(/[^\d.,]/g, "").replace(/,/g, "."));
  const validAmount = Number.isFinite(amountNum) && amountNum >= 0;

  const results = useMemo(() => {
    if (!data || !validAmount) return [];
    return currencies
      .filter((c) => c.code !== from)
      .map((c) => ({ code: c.code, label: c.label, value: convertClient(amountNum, from, c.code, rates) }))
      .filter((r): r is { code: string; label: string; value: number } => r.value != null && Number.isFinite(r.value));
  }, [data, validAmount, currencies, from, amountNum, rates]);

  return (
    <section className={`panel overflow-hidden ${className ?? ""}`}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="size-4 text-accent-primary" />
          <h2 className="text-[13px] font-semibold text-text-primary">Máy tính quy đổi tiền tệ</h2>
        </div>
        {meta && <MetaLine meta={meta} />}
      </header>
      <div className="grid gap-3 p-3.5 md:grid-cols-[minmax(0,220px)_1fr]">
        <div className="space-y-2">
          <label className="block text-[11px] text-text-muted">Số tiền</label>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent-primary/60"
            placeholder="100"
          />
          <label className="block text-[11px] text-text-muted">Từ</label>
          <select
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            disabled={isLoading || currencies.length === 0}
            className="w-full rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2 text-[13px] text-text-primary outline-none focus:border-accent-primary/60"
          >
            {currencies.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} — {c.label}
              </option>
            ))}
          </select>
          {!isLoading && currencies.length === 0 && (
            <p className="text-[10.5px] text-warning">Chưa lấy được tỷ giá — máy tính tạm dừng, không dùng số giả.</p>
          )}
          {data?.usdVndVietnamBiz && (
            <p className="rounded-md bg-surface-elevated px-2 py-1.5 text-[10px] leading-snug text-text-secondary">
              1 USD = <b className="num">{fmtNum(data.usdVndVietnamBiz.rate, 0)} VND</b> · {data.usdVndVietnamBiz.indicator}
              {data.usdVndVietnamBiz.period ? ` (${data.usdVndVietnamBiz.period})` : ""}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {!validAmount && <p className="col-span-full text-[11px] text-text-secondary">Nhập số tiền hợp lệ (≥ 0).</p>}
          {validAmount &&
            results.map((r) => (
              <div key={r.code} className="rounded-lg border border-border-subtle bg-surface-elevated px-3 py-2">
                <div className="flex items-baseline justify-between gap-1">
                  <span className="num text-[13px] font-semibold">{fmtNum(r.value, r.value >= 100 ? 0 : 2)}</span>
                  <span className="text-[10px] font-medium uppercase text-accent-primary">{r.code}</span>
                </div>
                <div className="truncate text-[10px] text-text-muted">{r.label}</div>
              </div>
            ))}
        </div>
      </div>
      {data && (
        <footer className="border-t border-border-subtle px-3.5 py-2 text-[10px] leading-relaxed text-text-muted">
          Nguồn: {data.source}
          {data.timestamp && (
            <>
              {" "}
              · cập nhật{" "}
              {new Date(data.timestamp).toLocaleString("vi-VN", {
                timeZone: "Asia/Ho_Chi_Minh",
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </>
          )}
          {" · "}Tỷ giá theo ngày, chỉ để tra cứu giá hàng hóa — không phải tỷ giá giao dịch ngân hàng.
        </footer>
      )}
    </section>
  );
}

export function currencyLabel(code: string, currencies: { code: string; label: string }[]): string {
  return currencies.find((c) => c.code === code)?.label ?? code;
}
