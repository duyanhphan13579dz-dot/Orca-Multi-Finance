"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import {
  loadProfileFromStorage,
  loadSnapshotsFromStorage,
  loadAssumptionsFromStorage,
  INITIAL_EMPTY_PROFILE,
} from "@/lib/personal-finance/storage";
import type { FinanceProfile, MonthlySnapshot, AssumptionSet } from "@/lib/personal-finance/types";
import { Panel } from "@/components/ui";

function fmtVnd(n: number) {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n);
}

export function PfDashboard() {
  const [profile, setProfile] = useState<FinanceProfile>(INITIAL_EMPTY_PROFILE);
  const [snapshots, setSnapshots] = useState<MonthlySnapshot[]>([]);
  const [assumptions, setAssumptions] = useState<AssumptionSet | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setProfile(loadProfileFromStorage());
    setSnapshots(loadSnapshotsFromStorage());
    setAssumptions(loadAssumptionsFromStorage());
    setHydrated(true);
  }, []);

  const latest = useMemo(() => {
    if (!snapshots.length) return null;
    return [...snapshots].sort((a, b) => b.period.localeCompare(a.period))[0];
  }, [snapshots]);

  const m = latest?.metrics;

  if (!hydrated) {
    return (
      <div className="p-4 text-[12px] text-text-muted">Đang tải dữ liệu tài chính cá nhân…</div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[17px] font-semibold text-text-primary">Tài chính cá nhân</h1>
          <p className="mt-0.5 text-[11.5px] text-text-muted">
            Orca Wallet trong Multi · local-first · đổi chế độ ở Cài đặt → Hồ sơ
          </p>
        </div>
        <Link
          href="/pf/checkin"
          className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px] font-medium text-text-primary hover:bg-accent/20"
        >
          Check-in tháng
        </Link>
      </header>

      {!latest || !m ? (
        <Panel className="p-4">
          <p className="text-[13px] text-text-primary">Chưa có snapshot tháng nào.</p>
          <p className="mt-1 text-[11.5px] text-text-muted">
            Check-in để nhập thu/chi. Engines tại{" "}
            <code className="text-[11px]">src/lib/personal-finance</code>.
          </p>
          <Link href="/pf/checkin" className="mt-3 inline-block text-[12px] text-accent underline">
            Mở Check-in →
          </Link>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Kỳ" value={latest.period} />
            <Metric label="Health score" value={String(m.healthScore?.total ?? "—")} />
            <Metric label="Net worth" value={fmtVnd(m.netWorth)} />
            <Metric label="Tiết kiệm tháng" value={fmtVnd(m.monthlySavings)} />
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Metric label="Thu net" value={fmtVnd(m.totalNetIncome)} />
            <Metric label="Chi tiêu" value={fmtVnd(m.totalExpenses)} />
            <Metric label="Tỷ lệ tiết kiệm" value={`${(m.savingsRate ?? 0).toFixed(1)}%`} />
            <Metric label="Quỹ KH cấp (tháng)" value={(m.emergencyFundMonths ?? 0).toFixed(1)} />
          </div>
          <Panel className="p-3">
            <h2 className="text-[13px] font-semibold text-text-primary">Lối tắt</h2>
            <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
              <Link className="text-accent underline" href="/pf/analytics">
                Phân tích
              </Link>
              <Link className="text-accent underline" href="/pf/planning">
                Kế hoạch
              </Link>
              <Link className="text-accent underline" href="/pf/advice">
                Lời khuyên
              </Link>
              <Link className="text-accent underline" href="/pf/report">
                Báo cáo
              </Link>
              <Link className="text-accent underline" href="/pf/privacy">
                Riêng tư
              </Link>
            </div>
          </Panel>
        </>
      )}

      <p className="text-[10.5px] text-text-muted">
        Hồ sơ: sinh {profile.birthYear} · {profile.employmentType} · risk {profile.riskTolerance}
        {assumptions ? ` · lạm phát giả định ${assumptions.inflationRate}%` : ""}
      </p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Panel className="p-3">
      <div className="text-[10.5px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="mt-1 text-[14px] font-semibold tabular-nums text-text-primary">{value}</div>
    </Panel>
  );
}
