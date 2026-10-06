"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Panel } from "@/components/ui";
import {
  loadSnapshotsFromStorage,
  loadAssumptionsFromStorage,
  saveAssumptionsToStorage,
  loadGoalsFromStorage,
  saveGoalsToStorage,
  loadProfileFromStorage,
} from "@/lib/personal-finance/storage";
import type { AssumptionSet, FinancialGoal, GoalPriority } from "@/lib/personal-finance/types";
import { evaluateGoals } from "@/lib/personal-finance/engines/goalsEngine";
import {
  runFinancialProjection,
  DEFAULT_ASSUMPTIONS,
} from "@/lib/personal-finance/engines/projectionEngine";
import { currentPeriodYm, uid } from "@/lib/personal-finance/build-snapshot";

function fmtVnd(n: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

const inp =
  "w-full rounded-lg border border-border-subtle bg-surface-elevated px-2 py-1.5 text-[12px]";

export function PfPlanning() {
  const [goals, setGoals] = useState<FinancialGoal[]>([]);
  const [assumptions, setAssumptions] = useState<AssumptionSet>(DEFAULT_ASSUMPTIONS);
  const [name, setName] = useState("");
  const [target, setTarget] = useState(100_000_000);
  const [accumulated, setAccumulated] = useState(0);
  const [deadline, setDeadline] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 2);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [priority, setPriority] = useState<GoalPriority>("medium");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setGoals(loadGoalsFromStorage());
    setAssumptions(loadAssumptionsFromStorage());
  }, []);

  const snap = useMemo(() => {
    return loadSnapshotsFromStorage().sort((a, b) => b.period.localeCompare(a.period))[0] ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goals, tick]);

  const period = snap?.period ?? currentPeriodYm();
  const monthlySavings = snap?.metrics.monthlySavings ?? 0;

  const evaluated = useMemo(
    () => evaluateGoals(goals, period, Math.max(0, monthlySavings)),
    [goals, period, monthlySavings],
  );

  const profile = loadProfileFromStorage();
  const age = new Date().getFullYear() - (profile.birthYear || 1996);

  const projection = useMemo(() => {
    const nw = snap?.metrics.netWorth ?? 0;
    const annual = Math.max(0, monthlySavings) * 12;
    return runFinancialProjection({
      currentAge: age,
      currentNetWorth: Math.max(0, nw),
      annualSavings: annual,
      assumptions,
      riskTolerance: profile.riskTolerance,
    });
  }, [snap, assumptions, age, monthlySavings, profile.riskTolerance]);

  const persistGoals = (next: FinancialGoal[]) => {
    setGoals(next);
    saveGoalsToStorage(next);
  };

  const addGoal = () => {
    if (!name.trim() || target <= 0) return;
    persistGoals([
      ...goals,
      {
        id: uid("goal"),
        name: name.trim(),
        targetAmount: target,
        accumulatedAmount: accumulated,
        deadline,
        priority,
        status: "on_track",
      },
    ]);
    setName("");
    setAccumulated(0);
  };

  const removeGoal = (id: string) => {
    persistGoals(goals.filter((g) => g.id !== id));
  };

  const saveAssumptions = () => {
    saveAssumptionsToStorage({
      ...assumptions,
      updatedAt: new Date().toLocaleDateString("vi-VN"),
    });
    setTick((t) => t + 1);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-4">
      <Link href="/pf" className="text-[11px] text-accent underline">
        ← Tổng quan PF
      </Link>
      <h1 className="text-[17px] font-semibold text-text-primary">Kế hoạch</h1>
      <p className="text-[11.5px] text-text-muted">
        Mục tiêu + projection nghỉ hưu. Snapshot: {snap ? snap.period : "chưa có"}.
      </p>

      <Panel className="p-3">
        <h2 className="text-[13px] font-semibold">Mục tiêu</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
          <input className={inp} placeholder="Tên" value={name} onChange={(e) => setName(e.target.value)} />
          <input
            className={inp}
            type="number"
            placeholder="Mục tiêu ₫"
            value={target}
            onChange={(e) => setTarget(Number(e.target.value) || 0)}
          />
          <input
            className={inp}
            type="number"
            placeholder="Đã có ₫"
            value={accumulated}
            onChange={(e) => setAccumulated(Number(e.target.value) || 0)}
          />
          <input className={inp} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <select
            className={inp}
            value={priority}
            onChange={(e) => setPriority(e.target.value as GoalPriority)}
          >
            <option value="high">Cao</option>
            <option value="medium">TB</option>
            <option value="low">Thấp</option>
          </select>
        </div>
        <button
          type="button"
          onClick={addGoal}
          className="mt-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px]"
        >
          + Thêm mục tiêu
        </button>

        <ul className="mt-3 space-y-2 text-[12px]">
          {evaluated.goals.length === 0 && (
            <li className="text-text-muted">Chưa có mục tiêu.</li>
          )}
          {evaluated.goals.map((g) => (
            <li
              key={g.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle px-2 py-2"
            >
              <div>
                <div className="font-medium text-text-primary">
                  {g.name}{" "}
                  <span className="text-[10px] text-text-muted">({g.status})</span>
                </div>
                <div className="text-[11px] text-text-muted">
                  {fmtVnd(g.accumulatedAmount)} / {fmtVnd(g.targetAmount)} · cần{" "}
                  {fmtVnd(g.requiredMonthlySavings)}/tháng · còn {g.monthsLeft} tháng
                  {g.lagPercent > 10 ? ` · chậm ${g.lagPercent}%` : ""}
                </div>
              </div>
              <button
                type="button"
                className="text-[11px] text-rose-300 underline"
                onClick={() => removeGoal(g.id)}
              >
                Xóa
              </button>
            </li>
          ))}
        </ul>
        {evaluated.goals.length > 0 && (
          <p className="mt-2 text-[11px] text-text-muted">
            Tổng cần cho mục tiêu mở:{" "}
            <strong>{fmtVnd(evaluated.totalRequiredMonthly)}/tháng</strong>
            {monthlySavings > 0 && (
              <>
                {" "}· năng lực {fmtVnd(monthlySavings)}/tháng
                {evaluated.totalRequiredMonthly > monthlySavings ? " (thiếu)" : " (đủ)"}
              </>
            )}
          </p>
        )}
      </Panel>

      <Panel className="p-3">
        <h2 className="text-[13px] font-semibold">Giả định & projection</h2>
        <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4 text-[12px]">
          {(
            [
              ["inflationRate", "Lạm phát %"],
              ["salaryGrowthRate", "Tăng lương %"],
              ["returnsBase", "Lợi suất base %"],
              ["retirementAge", "Tuổi nghỉ hưu"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="text-[11px] text-text-muted">
              {label}
              <input
                className={inp + " mt-1"}
                type="number"
                step="0.1"
                value={assumptions[key]}
                onChange={(e) =>
                  setAssumptions({ ...assumptions, [key]: Number(e.target.value) || 0 })
                }
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={saveAssumptions}
          className="mt-2 rounded-lg border border-border-subtle px-3 py-1.5 text-[12px]"
        >
          Lưu giả định
        </button>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Tuổi hiện tại" value={String(age)} />
          <Stat
            label="Danh mục lúc nghỉ hưu"
            value={fmtVnd(projection.retirement.portfolioAtRetirement)}
          />
          <Stat
            label="Thực (đã trừ lạm phát)"
            value={fmtVnd(projection.retirement.realPortfolioAtRetirement)}
          />
          <Stat
            label="Chi bền vững / tháng (4%)"
            value={fmtVnd(projection.retirement.sustainableMonthlySpend)}
          />
        </div>
        <p className="mt-2 text-[11px] text-text-muted">
          Lợi suất: {projection.annualReturnUsed.toFixed(1)}%/năm · {projection.series.length} điểm
          đến tuổi {assumptions.retirementAge}
        </p>
        <div className="mt-2 max-h-40 overflow-y-auto text-[11px] text-text-muted">
          {projection.series
            .filter((_, i) => i % Math.max(1, Math.floor(projection.series.length / 8)) === 0)
            .map((p) => (
              <div
                key={p.year}
                className="flex justify-between border-b border-border-subtle/40 py-0.5"
              >
                <span>
                  {p.year} · tuổi {p.age}
                </span>
                <span className="tabular-nums">{fmtVnd(p.portfolio)}</span>
              </div>
            ))}
        </div>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border-subtle p-2">
      <div className="text-[10px] uppercase text-text-muted">{label}</div>
      <div className="mt-0.5 text-[12px] font-semibold tabular-nums">{value}</div>
    </div>
  );
}
