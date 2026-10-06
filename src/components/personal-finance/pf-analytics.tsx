"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import { loadSnapshotsFromStorage } from "@/lib/personal-finance/storage";
import type { MonthlySnapshot } from "@/lib/personal-finance/types";

function fmtVnd(n: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function PfAnalytics() {
  const [snaps, setSnaps] = useState<MonthlySnapshot[]>([]);

  useEffect(() => {
    setSnaps(loadSnapshotsFromStorage().sort((a, b) => b.period.localeCompare(a.period)));
  }, []);

  const latest = snaps[0];

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <Link href="/pf" className="text-[11px] text-accent underline">
        ← Tổng quan PF
      </Link>
      <h1 className="text-[17px] font-semibold text-text-primary">Phân tích</h1>

      {!latest ? (
        <Panel className="p-4 text-[12px] text-text-muted">
          Chưa có snapshot.{" "}
          <Link href="/pf/checkin" className="text-accent underline">
            Check-in
          </Link>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            <Card label="Chi cố định" value={fmtVnd(latest.metrics.fixedExpenses)} />
            <Card label="Chi biến đổi" value={fmtVnd(latest.metrics.variableExpenses)} />
            <Card label="Fixed cost ratio" value={`${latest.metrics.fixedCostRatio.toFixed(1)}%`} />
            <Card label="DTI" value={`${latest.metrics.debtToIncomeRatio.toFixed(1)}%`} />
            <Card label="Liquid assets" value={fmtVnd(latest.metrics.liquidAssets)} />
            <Card label="Invested" value={fmtVnd(latest.metrics.investedAssets)} />
          </div>
          <Panel className="p-3">
            <h2 className="text-[13px] font-semibold">Health breakdown · {latest.period}</h2>
            <ul className="mt-2 space-y-1 text-[12px] text-text-muted">
              <li>Cashflow: {latest.metrics.healthScore.cashflowScore}/25</li>
              <li>Emergency: {latest.metrics.healthScore.emergencyScore}/25</li>
              <li>Debt: {latest.metrics.healthScore.debtScore}/20</li>
              <li>Net worth: {latest.metrics.healthScore.networthScore}/20</li>
              <li>Discipline: {latest.metrics.healthScore.disciplineScore}/10</li>
            </ul>
          </Panel>
          <Panel className="p-3">
            <h2 className="text-[13px] font-semibold">Lịch sử kỳ</h2>
            <ul className="mt-2 space-y-1 text-[12px]">
              {snaps.map((s) => (
                <li
                  key={s.period}
                  className="flex justify-between border-b border-border-subtle/50 py-1"
                >
                  <span>{s.period}</span>
                  <span className="tabular-nums text-text-muted">
                    HS {s.metrics.healthScore.total} · NW {fmtVnd(s.metrics.netWorth)}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <Panel className="p-3">
      <div className="text-[10.5px] uppercase text-text-muted">{label}</div>
      <div className="mt-1 text-[13px] font-semibold tabular-nums">{value}</div>
    </Panel>
  );
}
