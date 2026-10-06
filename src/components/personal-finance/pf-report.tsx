"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import { loadSnapshotsFromStorage, loadGoalsFromStorage } from "@/lib/personal-finance/storage";
import type { MonthlySnapshot } from "@/lib/personal-finance/types";
import { generateQuantitativeAdvice } from "@/lib/personal-finance/engines/adviceEngine";
import { evaluateGoals } from "@/lib/personal-finance/engines/goalsEngine";

function fmtVnd(n: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function PfReport() {
  const [snap, setSnap] = useState<MonthlySnapshot | null>(null);

  useEffect(() => {
    const s = loadSnapshotsFromStorage().sort((a, b) => b.period.localeCompare(a.period))[0];
    setSnap(s ?? null);
  }, []);

  const insights = useMemo(
    () => (snap ? generateQuantitativeAdvice({ snapshot: snap }) : []),
    [snap],
  );

  const goals = useMemo(() => {
    if (!snap) return null;
    return evaluateGoals(loadGoalsFromStorage(), snap.period, snap.metrics.monthlySavings);
  }, [snap]);

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4 print:max-w-none">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link href="/pf" className="text-[11px] text-accent underline print:hidden">
            ← Tổng quan PF
          </Link>
          <h1 className="text-[17px] font-semibold text-text-primary">Báo cáo tài chính cá nhân</h1>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-[12px] print:hidden"
        >
          In / PDF
        </button>
      </div>

      {!snap ? (
        <Panel className="p-4 text-[12px] text-text-muted">
          Chưa có snapshot.{" "}
          <Link href="/pf/checkin" className="text-accent underline">
            Check-in
          </Link>
        </Panel>
      ) : (
        <>
          <Panel className="p-3 text-[12px]">
            <h2 className="font-semibold">Kỳ {snap.period}</h2>
            <p className="mt-1 text-text-muted">
              Engine {snap.engineVersion} · {new Date(snap.timestamp).toLocaleString("vi-VN")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
              <Cell
                label="Health"
                value={`${snap.metrics.healthScore.total} (${snap.metrics.healthScore.ratingText})`}
              />
              <Cell label="Net worth" value={fmtVnd(snap.metrics.netWorth)} />
              <Cell label="Thu net" value={fmtVnd(snap.metrics.totalNetIncome)} />
              <Cell label="Tiết kiệm" value={fmtVnd(snap.metrics.monthlySavings)} />
              <Cell label="Savings rate" value={`${snap.metrics.savingsRate.toFixed(1)}%`} />
              <Cell
                label="Emergency"
                value={`${snap.metrics.emergencyFundMonths.toFixed(1)} tháng`}
              />
              <Cell label="DTI" value={`${snap.metrics.debtToIncomeRatio.toFixed(1)}%`} />
              <Cell label="Thuế TNCN" value={fmtVnd(snap.income.personalIncomeTax)} />
            </div>
          </Panel>

          <Panel className="p-3 text-[12px]">
            <h2 className="font-semibold">Insights</h2>
            <ul className="mt-2 space-y-2">
              {insights.map((i) => (
                <li key={i.id} className="rounded-lg border border-border-subtle px-2 py-2">
                  <div className="font-medium">
                    [{i.severity}] {i.title}
                  </div>
                  <div className="text-[11px] text-text-muted">{i.content.finding}</div>
                  <div className="text-[11px] text-text-muted">→ {i.content.action}</div>
                </li>
              ))}
            </ul>
          </Panel>

          {goals && goals.goals.length > 0 && (
            <Panel className="p-3 text-[12px]">
              <h2 className="font-semibold">Mục tiêu</h2>
              <ul className="mt-2 space-y-1 text-text-muted">
                {goals.goals.map((g) => (
                  <li key={g.id}>
                    {g.name}: {fmtVnd(g.accumulatedAmount)}/{fmtVnd(g.targetAmount)} · {g.status}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle p-2">
      <div className="text-[10px] uppercase text-text-muted">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}
