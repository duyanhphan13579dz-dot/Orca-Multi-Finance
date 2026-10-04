"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useApi } from "@/lib/hooks";
import { Badge, FreshnessDot, Loading, Panel, Unavailable } from "@/components/ui";
import { ChevronDown } from "lucide-react";

type Row = {
  symbol: string;
  name: string | null;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  beta: number | null;
  betaAdj: number | null;
  betaUp: number | null;
  betaDown: number | null;
  alphaAnnual: number | null;
  alphaT: number | null;
  r2: number | null;
  n: number;
  profile: string;
  profileVi: string;
  reliable: boolean;
  summary: string;
};

type Data = {
  rows: Row[];
  scanned: number;
  skipped: number;
  filters: Record<string, unknown>;
  engine: string;
};

const PROFILES = [
  { v: "any", l: "Tất cả hồ sơ" },
  { v: "alpha_high_beta_low", l: "Alpha cao · Beta thấp" },
  { v: "alpha_high_beta_high", l: "Alpha cao · Beta cao" },
  { v: "alpha_flat_beta_high", l: "Alpha ≈ 0 · Beta cao" },
  { v: "alpha_neg_beta_low", l: "Alpha âm · Beta thấp" },
  { v: "alpha_neg_beta_high", l: "Alpha âm · Beta cao" },
] as const;

function buildQs(opts: {
  profile: string;
  minAlphaT: string;
  maxBeta: string;
  reliable: boolean;
  sector: string;
  symbols: string;
  bust?: number;
}) {
  const qs = new URLSearchParams({
    profile: opts.profile,
    minAlphaT: opts.minAlphaT || "0",
    maxBeta: opts.maxBeta || "99",
    limit: "40",
  });
  if (opts.reliable) qs.set("reliable", "1");
  if (opts.sector) qs.set("sector", opts.sector);
  const symbols = opts.symbols
    .split(/[\s,;]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length) qs.set("symbols", symbols.join(","));
  if (opts.bust) qs.set("_", String(opts.bust));
  return qs.toString();
}

function profileTone(p: string): "up" | "down" | "warn" | "neutral" {
  if (p === "alpha_high_beta_low" || p === "alpha_high_beta_high") return "up";
  if (p === "alpha_neg_beta_high") return "down";
  if (p === "alpha_flat_beta_high") return "warn";
  return "neutral";
}

/** Dark-theme listbox — native <option> forces light OS menu on many browsers. */
function ProfileSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = PROFILES.find((p) => p.v === value)?.l ?? "Tất cả hồ sơ";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative w-48">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="input flex w-full !w-48 items-center justify-between gap-1.5 !py-1.5 text-left text-[12px] shadow-[0_2px_10px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.04)]"
      >
        <span className="truncate text-text-primary">{label}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-border-default bg-[var(--color-surface-modal)] py-1 shadow-[0_12px_28px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.04)]"
        >
          {PROFILES.map((p) => {
            const active = p.v === value;
            return (
              <li key={p.v} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(p.v);
                    setOpen(false);
                  }}
                  className={`flex w-full px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    active
                      ? "bg-accent-primary/20 font-medium text-accent-primary"
                      : "text-text-primary hover:bg-surface-elevated"
                  }`}
                >
                  {p.l}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

export function AlphaBetaScreener({ defaultSector }: { defaultSector: string | null }) {
  const [profile, setProfile] = useState("alpha_high_beta_low");
  const [minAlphaT, setMinAlphaT] = useState("2");
  const [maxBeta, setMaxBeta] = useState("1.1");
  const [reliable, setReliable] = useState(false);
  const [sector, setSector] = useState(defaultSector ?? "");
  const [symbols, setSymbols] = useState("");
  const [query, setQuery] = useState(() =>
    buildQs({
      profile: "alpha_high_beta_low",
      minAlphaT: "2",
      maxBeta: "1.1",
      reliable: false,
      sector: defaultSector ?? "",
      symbols: "",
    }),
  );
  const [pressed, setPressed] = useState(false);

  const { res, data, meta, isLoading, isValidating, mutate } = useApi<Data>(
    `/api/v1/screener/alpha-beta?${query}`,
    { refreshInterval: 120_000 },
  );

  const run = useCallback(() => {
    setPressed(true);
    setQuery(
      buildQs({
        profile,
        minAlphaT,
        maxBeta,
        reliable,
        sector,
        symbols,
        bust: Date.now(),
      }),
    );
    void mutate();
    window.setTimeout(() => setPressed(false), 180);
  }, [profile, minAlphaT, maxBeta, reliable, sector, symbols, mutate]);

  if (isLoading && !res) return <Loading rows={8} />;
  if (!res?.success) {
    return (
      <Unavailable
        title="Bộ lọc hệ số cổ phiếu chưa sẵn sàng"
        note={res && !res.success ? res.error.message : undefined}
      />
    );
  }

  const rows = data?.rows ?? [];

  return (
    <Panel
      title={
        <span>
          Hệ số cổ phiếu (Alpha · Beta){" "}
          <FreshnessDot status={meta?.freshness} ageMs={meta?.ageMs} />
          {isValidating ? (
            <span className="ml-1.5 text-[10px] text-accent-primary">· đang quét</span>
          ) : null}
        </span>
      }
      pad={false}
    >
      <div className="flex flex-wrap items-end gap-2 border-b border-line p-3">
        <label className="block">
          <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Hồ sơ</span>
          <ProfileSelect value={profile} onChange={setProfile} />
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">|t-α| min</span>
          <input
            value={minAlphaT}
            onChange={(e) => setMinAlphaT(e.target.value)}
            className="input !w-20 !py-1.5 text-[12px]"
          />
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">β max</span>
          <input
            value={maxBeta}
            onChange={(e) => setMaxBeta(e.target.value)}
            className="input !w-20 !py-1.5 text-[12px]"
          />
        </label>
        <label className="flex items-center gap-1.5 pb-1.5 text-[12px] text-text-secondary">
          <input type="checkbox" checked={reliable} onChange={(e) => setReliable(e.target.checked)} />
          Chỉ R² tin cậy
        </label>
        <label>
          <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Mã</span>
          <input
            value={symbols}
            onChange={(e) => setSymbols(e.target.value)}
            placeholder="VCB, FPT…"
            className="input !w-32 !py-1.5 text-[12px]"
          />
        </label>
        <button
          type="button"
          onClick={run}
          className={`rounded-md px-3.5 py-1.5 text-[12px] font-semibold text-white ${
            pressed ? "bg-accent-primary" : "bg-accent-primary/90"
          }`}
        >
          {isValidating ? "Đang lọc…" : "Lọc hệ số"}
        </button>
      </div>

      <p className="border-b border-line px-3 py-2 text-[11px] text-text-muted">
        CAPM tuần · benchmark VNINDEX · {data?.scanned ?? 0} mã đã quét
        {data?.engine ? ` · ${data.engine}` : ""}. Nghiên cứu, không phải khuyến nghị.
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wider text-text-muted">
              <th className="px-3 py-2 font-medium">Mã</th>
              <th className="px-2 py-2 font-medium">α/năm</th>
              <th className="px-2 py-2 font-medium">t-α</th>
              <th className="px-2 py-2 font-medium">β</th>
              <th className="px-2 py-2 font-medium">β adj</th>
              <th className="px-2 py-2 font-medium">R²</th>
              <th className="px-2 py-2 font-medium">Hồ sơ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-text-muted">
                  Không có mã khớp bộ lọc.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.symbol} className="border-b border-line/60 hover:bg-surface-elevated/40">
                  <td className="px-3 py-2">
                    <Link href={`/stocks/${r.symbol}`} className="font-semibold text-accent-primary hover:underline">
                      {r.symbol}
                    </Link>
                    {r.name ? <div className="text-[10px] text-text-muted">{r.name}</div> : null}
                  </td>
                  <td className={`px-2 py-2 num ${(r.alphaAnnual ?? 0) >= 0 ? "text-up" : "text-down"}`}>
                    {r.alphaAnnual != null ? `${(r.alphaAnnual * 100).toFixed(1)}%` : "—"}
                  </td>
                  <td className="px-2 py-2 num">{r.alphaT != null ? r.alphaT.toFixed(2) : "—"}</td>
                  <td className="px-2 py-2 num">{r.beta != null ? r.beta.toFixed(2) : "—"}</td>
                  <td className="px-2 py-2 num">{r.betaAdj != null ? r.betaAdj.toFixed(2) : "—"}</td>
                  <td className="px-2 py-2 num">
                    {r.r2 != null ? `${(r.r2 * 100).toFixed(0)}%` : "—"}
                    {!r.reliable ? <span className="ml-1 text-[9px] text-text-muted">⚠</span> : null}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={profileTone(r.profile)}>{r.profileVi}</Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
