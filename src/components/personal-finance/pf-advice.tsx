"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import { loadSnapshotsFromStorage } from "@/lib/personal-finance/storage";
import type { MonthlySnapshot } from "@/lib/personal-finance/types";

export function PfAdvice() {
  const [snap, setSnap] = useState<MonthlySnapshot | null>(null);

  useEffect(() => {
    const s = loadSnapshotsFromStorage().sort((a, b) => b.period.localeCompare(a.period))[0];
    setSnap(s ?? null);
  }, []);

  const tips = useMemo(() => {
    if (!snap) return [];
    const m = snap.metrics;
    const out: { title: string; body: string }[] = [];
    if (m.savingsRate < 10) {
      out.push({
        title: "Tỷ lệ tiết kiệm thấp",
        body: `Hiện ${m.savingsRate.toFixed(1)}%. Mục tiêu tối thiểu 10–20% thu nhập net.`,
      });
    }
    if (m.emergencyFundMonths < 3) {
      out.push({
        title: "Quỹ khẩn cấp mỏng",
        body: `Chỉ đủ ~${m.emergencyFundMonths.toFixed(1)} tháng chi thiết yếu. Ưu tiên tích lũy tới 3–6 tháng.`,
      });
    }
    if (m.debtToIncomeRatio > 30) {
      out.push({
        title: "DTI cao",
        body: `Trả nợ tối thiểu chiếm ${m.debtToIncomeRatio.toFixed(1)}% thu net. Ưu tiên nợ lãi cao.`,
      });
    }
    if (m.fixedCostRatio > 65) {
      out.push({
        title: "Chi cố định nặng",
        body: `Fixed cost ${m.fixedCostRatio.toFixed(1)}% thu net. Xem lại nhà ở / trả góp.`,
      });
    }
    if (m.healthScore.total >= 70) {
      out.push({
        title: "Sức khỏe tài chính ổn",
        body: `Health score ${m.healthScore.total} (${m.healthScore.ratingText}). Giữ nhịp check-in hàng tháng.`,
      });
    }
    if (out.length === 0) {
      out.push({
        title: "Tiếp tục theo dõi",
        body: "Chưa có cảnh báo mạnh. Duy trì check-in và cập nhật mục tiêu.",
      });
    }
    return out;
  }, [snap]);

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 sm:p-4">
      <Link href="/pf" className="text-[11px] text-accent underline">
        ← Tổng quan PF
      </Link>
      <h1 className="text-[17px] font-semibold text-text-primary">Lời khuyên</h1>
      {!snap ? (
        <Panel className="p-4 text-[12px] text-text-muted">
          Cần snapshot.{" "}
          <Link href="/pf/checkin" className="text-accent underline">
            Check-in
          </Link>
        </Panel>
      ) : (
        <div className="space-y-2">
          {tips.map((t) => (
            <Panel key={t.title} className="p-3">
              <div className="text-[12px] font-semibold text-text-primary">{t.title}</div>
              <p className="mt-1 text-[11.5px] text-text-muted">{t.body}</p>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
