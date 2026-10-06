"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import { loadSnapshotsFromStorage } from "@/lib/personal-finance/storage";
import type { MonthlySnapshot } from "@/lib/personal-finance/types";
import { generateQuantitativeAdvice } from "@/lib/personal-finance/engines/adviceEngine";

function fmtVnd(n: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export function PfAdvice() {
  const [snap, setSnap] = useState<MonthlySnapshot | null>(null);

  useEffect(() => {
    const s = loadSnapshotsFromStorage().sort((a, b) => b.period.localeCompare(a.period))[0];
    setSnap(s ?? null);
  }, []);

  const insights = useMemo(
    () => (snap ? generateQuantitativeAdvice({ snapshot: snap }) : []),
    [snap],
  );

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 sm:p-4">
      <Link href="/pf" className="text-[11px] text-accent underline">
        ← Tổng quan PF
      </Link>
      <h1 className="text-[17px] font-semibold text-text-primary">Lời khuyên</h1>
      <p className="text-[11.5px] text-text-muted">Rule-based từ adviceEngine (W3).</p>

      {!snap ? (
        <Panel className="p-4 text-[12px] text-text-muted">
          Cần snapshot.{" "}
          <Link href="/pf/checkin" className="text-accent underline">
            Check-in
          </Link>
        </Panel>
      ) : (
        <div className="space-y-2">
          {insights.map((i) => (
            <Panel key={i.id} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-semibold text-text-primary">{i.title}</div>
                <span className="text-[10px] uppercase text-text-muted">{i.severity}</span>
              </div>
              <p className="mt-1 text-[11.5px] text-text-muted">{i.content.finding}</p>
              <p className="mt-1 text-[11.5px] text-text-primary">
                <strong>Hành động:</strong> {i.content.action}
              </p>
              {i.content.amount > 0 && (
                <p className="mt-1 text-[11px] text-text-muted">
                  Số tiền gợi ý: {fmtVnd(i.content.amount)} · hạn {i.content.deadline}
                </p>
              )}
              <p className="mt-1 text-[10.5px] text-text-muted">{i.content.assumptionsAndConfidence}</p>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
