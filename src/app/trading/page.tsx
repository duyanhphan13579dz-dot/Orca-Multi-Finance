"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, RefreshCw } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { Badge, Loading, MetaLine, Panel, Unavailable, fmtNum } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* types (phòng thủ — SSI trả string, thiếu đủ kiểu)                   */
/* ------------------------------------------------------------------ */

type SsiAccount = { accountNo: string; accountType?: string };

type SsiAccountData = {
  accounts: SsiAccount[];
  accountNo: string;
  balance: Record<string, unknown> | null;
  positions: Record<string, unknown> | null;
  ppmmr: Record<string, unknown> | null;
  errors: string[];
};

type SsiOrder = {
  orderId?: string;
  symbol?: string;
  side?: string;
  orderType?: string;
  quantity?: number | string;
  price?: number | string;
  filledQty?: number | string;
  cancelQty?: number | string;
  avgPrice?: number | string;
  inputTime?: string;
  orderStatus?: string;
  message?: string;
};

type SsiOrdersData = {
  orderBook: { orderList?: SsiOrder[]; data?: { orderList?: SsiOrder[]; totalRecord?: number }; totalRecord?: number } | null;
  statusLabels: Record<string, string>;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v == null ? "" : String(v));

function equityOf(balance: Record<string, unknown> | null): Record<string, unknown> {
  const eq = balance?.equity;
  return (eq && typeof eq === "object" ? eq : {}) as Record<string, unknown>;
}

function orderListOf(book: SsiOrdersData["orderBook"]): SsiOrder[] {
  if (!book) return [];
  if (Array.isArray(book.orderList)) return book.orderList;
  if (book.data && Array.isArray(book.data.orderList)) return book.data.orderList;
  return [];
}

function statusTone(s: string): "up" | "down" | "warn" | "accent" | "neutral" {
  if (s === "FF") return "up";
  if (s === "PF") return "accent";
  if (s === "RJ" || s === "RD" || s === "MR" || s === "EX") return "down";
  if (s === "CL" || s === "CA" || s === "WC") return "warn";
  return "neutral";
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit", day: "2-digit", month: "2-digit" });
}

/* ------------------------------------------------------------------ */

export default function TradingPage() {
  const accountRes = useApi<SsiAccountData>("/api/v1/ssi/account", { refreshInterval: 60_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const [symFilter, setSymFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const accounts = accountRes.data?.accounts ?? [];
  const accountNo = picked ?? accountRes.data?.accountNo ?? accounts[0]?.accountNo ?? "";

  const ordersRes = useApi<SsiOrdersData>(
    accountNo ? `/api/v1/ssi/orders?accountNo=${encodeURIComponent(accountNo)}&pageSize=100` : null,
    { refreshInterval: 30_000 },
  );

  const equity = equityOf(accountRes.data?.balance ?? null);
  const labels = ordersRes.data?.statusLabels ?? {};

  const orders = useMemo(() => {
    const list = orderListOf(ordersRes.data?.orderBook ?? null);
    const fSym = symFilter.trim().toUpperCase();
    return list
      .filter((o) => (!fSym || (o.symbol ?? "").toUpperCase().includes(fSym)))
      .filter((o) => (!statusFilter || o.orderStatus === statusFilter))
      .slice()
      .sort((a, b) => (b.inputTime ?? "").localeCompare(a.inputTime ?? ""));
  }, [ordersRes.data, symFilter, statusFilter]);

  /* ------------------------------ states ------------------------------ */

  const accErr = accountRes.res && !accountRes.res.success ? accountRes.res.error : null;
  if (accErr?.code === "UNAUTHENTICATED") {
    return (
      <div className="space-y-4">
        <PageHead />
        <Panel title="Cần đăng nhập ORCA">
          <p className="text-[13px] text-ink-2">
            Sổ lệnh SSI gắn với tài khoản giao dịch của bạn — đăng nhập ORCA để truy vấn (dữ liệu không lộ khi chưa đăng nhập).
          </p>
          <Link href="/login" className="btn mt-3 inline-block">
            Đăng nhập
          </Link>
        </Panel>
      </div>
    );
  }
  if (accErr?.code === "SSI_NOT_CONFIGURED") {
    return (
      <div className="space-y-4">
        <PageHead />
        <Panel title="Chưa cấu hình SSI FastConnect">
          <p className="text-[13px] text-ink-2">
            Set <code className="text-accent">SSI_API_KEY</code> + <code className="text-accent">SSI_API_SECRET</code> trên host
            (Vercel → Settings → Environment Variables) rồi deploy lại. Xem <code>/api/v1/ssi/status</code> để chẩn đoán.
          </p>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHead />

      {/* ------------------------------ tài khoản ------------------------------ */}
      <Panel
        title="Tài khoản SSI"
        right={
          <div className="flex items-center gap-2">
            {accounts.map((a) => (
              <button
                key={a.accountNo}
                onClick={() => setPicked(a.accountNo)}
                className={`rounded border px-2 py-1 text-[11px] ${
                  a.accountNo === accountNo
                    ? "border-accent/60 bg-accent/10 text-accent"
                    : "border-border-subtle text-ink-3 hover:text-ink"
                }`}
              >
                {a.accountNo}
                <span className="ml-1 text-[10px] opacity-70">{a.accountType}</span>
              </button>
            ))}
          </div>
        }
      >
        {accountRes.isLoading ? (
          <Loading rows={2} />
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Tổng tài sản" value={fmtNum(num(equity.accountBalance), 0)} />
            <Metric label="Sức mua / khả dụng" value={fmtNum(num(equity.withdrawable), 0)} />
            <Metric label="Dư nợ" value={fmtNum(num(equity.totalDebt), 0)} />
            <Metric label="Bán T0 / T1 / T2" value={`${fmtNum(num(equity.sellT0), 0)} / ${fmtNum(num(equity.sellT1), 0)} / ${fmtNum(num(equity.sellT2), 0)}`} />
          </div>
        )}
        {(accountRes.data?.errors?.length ?? 0) > 0 && (
          <p className="mt-2 text-[11px] text-warn">{accountRes.data?.errors.join(" · ")}</p>
        )}
        <MetaLine meta={accountRes.meta} />
      </Panel>

      {/* ------------------------------ sổ lệnh ------------------------------ */}
      <Panel
        title={
          <span className="flex items-center gap-2">
            <BookOpen className="size-3.5 text-accent" /> Sổ lệnh {accountNo || ""}
          </span>
        }
        right={
          <div className="flex items-center gap-2">
            <input
              value={symFilter}
              onChange={(e) => setSymFilter(e.target.value)}
              placeholder="Mã CK…"
              className="input w-24 px-2 py-1 text-[11px]"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="input px-2 py-1 text-[11px]"
            >
              <option value="">Mọi trạng thái</option>
              {Object.entries(labels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                accountRes.mutate();
                ordersRes.mutate();
              }}
              className="btn px-2 py-1 text-[11px]"
              aria-label="Làm mới sổ lệnh"
            >
              <RefreshCw className="size-3" />
            </button>
          </div>
        }
      >
        {ordersRes.isLoading ? (
          <Loading rows={6} />
        ) : ordersRes.res && !ordersRes.res.success ? (
          <Unavailable title="Không lấy được sổ lệnh SSI" note={ordersRes.res.error.message} meta={ordersRes.meta} />
        ) : orders.length === 0 ? (
          <p className="text-[12px] text-ink-3">
            Không có lệnh nào trong hôm nay cho {accountNo || "tài khoản"} — đổi bộ lọc hoặc kiểm tra khoảng thời gian (mặc định từ 00:00 hôm nay).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-wide text-ink-3">
                  <th className="py-1.5 pr-2">Thời gian</th>
                  <th className="py-1.5 pr-2">Mã</th>
                  <th className="py-1.5 pr-2">B/S</th>
                  <th className="py-1.5 pr-2">Loại</th>
                  <th className="py-1.5 pr-2 text-right">KL</th>
                  <th className="py-1.5 pr-2 text-right">Giá</th>
                  <th className="py-1.5 pr-2 text-right">Khớp</th>
                  <th className="py-1.5 pr-2 text-right">TB</th>
                  <th className="py-1.5 pr-2">Trạng thái</th>
                  <th className="py-1.5">Ghi chú</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o, i) => (
                  <tr key={o.orderId ?? i} className="border-b border-border-subtle/50">
                    <td className="py-1.5 pr-2 text-ink-3">{fmtTime(o.inputTime)}</td>
                    <td className="py-1.5 pr-2 font-semibold text-ink">{o.symbol}</td>
                    <td className={`py-1.5 pr-2 font-semibold ${o.side === "B" ? "text-up" : "text-down"}`}>
                      {o.side === "B" ? "Mua" : o.side === "S" ? "Bán" : o.side}
                    </td>
                    <td className="py-1.5 pr-2">{o.orderType}</td>
                    <td className="py-1.5 pr-2 text-right">{fmtNum(num(o.quantity), 0)}</td>
                    <td className="py-1.5 pr-2 text-right">{fmtNum(num(o.price), 2)}</td>
                    <td className="py-1.5 pr-2 text-right">{fmtNum(num(o.filledQty), 0)}</td>
                    <td className="py-1.5 pr-2 text-right">{fmtNum(num(o.avgPrice), 2)}</td>
                    <td className="py-1.5 pr-2">
                      <Badge tone={statusTone(o.orderStatus ?? "")}>
                        {labels[o.orderStatus ?? ""] ?? o.orderStatus ?? "—"}
                      </Badge>
                    </td>
                    <td className="max-w-40 truncate py-1.5 text-ink-3" title={str(o.message)}>
                      {str(o.message) || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <MetaLine meta={ordersRes.meta} />
        <p className="mt-2 text-[10px] text-ink-3">
          Chế độ xem (token data, không cần OTP). Đặt/sửa/hủy lệnh cần thêm SSI_PRIVATE_KEY + SSI_TRADING_ENABLED=true + OTP.
        </p>
      </Panel>
    </div>
  );
}

function PageHead() {
  return (
    <div>
      <h1 className="text-lg font-semibold text-ink">Sổ lệnh SSI</h1>
      <p className="text-[12px] text-ink-3">
        Tài khoản + sổ lệnh hôm nay từ SSI FastConnect v3 (trading/orderBook) — làm mới mỗi 30s.
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-border-subtle bg-line/20 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-ink-3">{label}</p>
      <p className="text-[14px] font-semibold text-ink">{value}</p>
    </div>
  );
}
