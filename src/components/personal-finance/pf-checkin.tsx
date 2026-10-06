"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Panel } from "@/components/ui";
import {
  loadProfileFromStorage,
  saveProfileToStorage,
  loadSnapshotsFromStorage,
  saveSnapshotsToStorage,
  INITIAL_EMPTY_PROFILE,
} from "@/lib/personal-finance/storage";
import type {
  FinanceProfile,
  ExpenseItem,
  AssetItem,
  DebtItem,
  ExpenseCategoryKey,
  AssetCategoryKey,
  DebtCategoryKey,
} from "@/lib/personal-finance/types";
import { buildMonthlySnapshot, currentPeriodYm, uid } from "@/lib/personal-finance/build-snapshot";

const EXPENSE_CATS: { key: ExpenseCategoryKey; label: string }[] = [
  { key: "housing", label: "Nhà ở" },
  { key: "utilities", label: "Điện nước" },
  { key: "food", label: "Ăn uống" },
  { key: "transport", label: "Đi lại" },
  { key: "education", label: "Giáo dục" },
  { key: "healthcare", label: "Y tế" },
  { key: "insurance", label: "Bảo hiểm" },
  { key: "entertainment", label: "Giải trí" },
  { key: "shopping", label: "Mua sắm" },
  { key: "family_support", label: "Gia đình" },
  { key: "other", label: "Khác" },
];

const ASSET_CATS: { key: AssetCategoryKey; label: string }[] = [
  { key: "cash", label: "Tiền mặt" },
  { key: "savings", label: "Tiết kiệm" },
  { key: "gold", label: "Vàng" },
  { key: "stocks", label: "Cổ phiếu" },
  { key: "funds", label: "Quỹ" },
  { key: "real_estate", label: "Bất động sản" },
  { key: "crypto", label: "Crypto" },
  { key: "other", label: "Khác" },
];

const DEBT_CATS: { key: DebtCategoryKey; label: string }[] = [
  { key: "credit_card", label: "Thẻ tín dụng" },
  { key: "mortgage", label: "Vay nhà" },
  { key: "car_loan", label: "Vay xe" },
  { key: "consumer_loan", label: "Vay tiêu dùng" },
  { key: "relative_loan", label: "Vay người thân" },
  { key: "other", label: "Khác" },
];

function fmtVnd(n: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(n || 0);
}

const STEPS = ["Hồ sơ", "Thu nhập", "Chi tiêu", "Tài sản & Nợ", "Xác nhận"] as const;

const inp =
  "w-full rounded-lg border border-border-subtle bg-surface-elevated px-2 py-1.5 text-[12px] text-text-primary";

export function PfCheckin() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [period, setPeriod] = useState(currentPeriodYm());
  const [profile, setProfile] = useState<FinanceProfile>(INITIAL_EMPTY_PROFILE);
  const [gross, setGross] = useState(20_000_000);
  const [bonus, setBonus] = useState(0);
  const [other, setOther] = useState(0);
  const [dependents, setDependents] = useState(0);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([
    { id: uid("exp"), category: "housing", name: "Thuê nhà", amount: 5_000_000, isFixed: true },
    { id: uid("exp"), category: "food", name: "Ăn uống", amount: 3_000_000, isFixed: false },
  ]);
  const [assets, setAssets] = useState<AssetItem[]>([
    {
      id: uid("ast"),
      category: "savings",
      name: "Tiết kiệm",
      balance: 50_000_000,
      updatedAt: new Date().toLocaleDateString("vi-VN"),
    },
  ]);
  const [debts, setDebts] = useState<DebtItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const p = loadProfileFromStorage();
    setProfile(p);
    setDependents(p.dependentsCount);
    const snaps = loadSnapshotsFromStorage();
    const latest = [...snaps].sort((a, b) => b.period.localeCompare(a.period))[0];
    if (latest) {
      if (latest.expenses.length) setExpenses(latest.expenses);
      if (latest.assets.length) setAssets(latest.assets);
      setDebts(latest.debts);
      setGross(latest.income.grossSalary || 20_000_000);
      setBonus(latest.income.bonus || 0);
      setOther(latest.income.otherIncome || 0);
    }
  }, []);

  const preview = useMemo(() => {
    try {
      return buildMonthlySnapshot({
        period,
        profile: { ...profile, dependentsCount: dependents },
        grossSalary: gross,
        bonus,
        otherIncome: other,
        dependentsCount: dependents,
        expenses,
        assets,
        debts,
        previousSnapshots: loadSnapshotsFromStorage(),
      });
    } catch {
      return null;
    }
  }, [period, profile, gross, bonus, other, dependents, expenses, assets, debts]);

  const save = () => {
    if (!preview) return;
    setSaving(true);
    try {
      const nextProfile: FinanceProfile = {
        ...profile,
        dependentsCount: dependents,
        updatedAt: new Date().toISOString(),
      };
      saveProfileToStorage(nextProfile);
      const existing = loadSnapshotsFromStorage().filter((s) => s.period !== period);
      saveSnapshotsToStorage(
        [preview, ...existing].sort((a, b) => b.period.localeCompare(a.period)),
      );
      setDone(true);
      setTimeout(() => router.push("/pf"), 600);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-3 p-3 sm:p-4">
      <header>
        <Link href="/pf" className="text-[11px] text-accent underline">
          ← Tổng quan PF
        </Link>
        <h1 className="mt-1 text-[17px] font-semibold text-text-primary">Check-in tháng</h1>
        <p className="mt-0.5 text-[11.5px] text-text-muted">
          Engines tính thuế TNCN, cashflow, health score trên thiết bị.
        </p>
      </header>

      <div className="flex flex-wrap gap-1">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(i)}
            className={`rounded-full px-2.5 py-1 text-[11px] ${
              i === step
                ? "bg-accent/20 font-medium text-text-primary"
                : i < step
                  ? "text-accent"
                  : "text-text-muted"
            }`}
          >
            {i + 1}. {s}
          </button>
        ))}
      </div>

      {step === 0 && (
        <Panel className="space-y-3 p-3">
          <label className="block text-[11px] text-text-muted">
            Kỳ (YYYY-MM)
            <input className={inp + " mt-1"} value={period} onChange={(e) => setPeriod(e.target.value)} />
          </label>
          <label className="block text-[11px] text-text-muted">
            Năm sinh
            <input
              className={inp + " mt-1"}
              type="number"
              value={profile.birthYear}
              onChange={(e) => setProfile({ ...profile, birthYear: Number(e.target.value) || 1990 })}
            />
          </label>
          <label className="block text-[11px] text-text-muted">
            Tình trạng
            <select
              className={inp + " mt-1"}
              value={profile.maritalStatus}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  maritalStatus: e.target.value as FinanceProfile["maritalStatus"],
                })
              }
            >
              <option value="single">Độc thân</option>
              <option value="married">Kết hôn</option>
              <option value="has_children">Có con</option>
            </select>
          </label>
          <label className="block text-[11px] text-text-muted">
            Việc làm
            <select
              className={inp + " mt-1"}
              value={profile.employmentType}
              onChange={(e) =>
                setProfile({
                  ...profile,
                  employmentType: e.target.value as FinanceProfile["employmentType"],
                })
              }
            >
              <option value="salaried">Lương</option>
              <option value="freelance">Freelance</option>
              <option value="business_owner">Kinh doanh</option>
              <option value="other">Khác</option>
            </select>
          </label>
        </Panel>
      )}

      {step === 1 && (
        <Panel className="space-y-3 p-3">
          <label className="block text-[11px] text-text-muted">
            Lương gộp / tháng (₫)
            <input
              className={inp + " mt-1"}
              type="number"
              value={gross}
              onChange={(e) => setGross(Number(e.target.value) || 0)}
            />
          </label>
          <label className="block text-[11px] text-text-muted">
            Thưởng (₫)
            <input
              className={inp + " mt-1"}
              type="number"
              value={bonus}
              onChange={(e) => setBonus(Number(e.target.value) || 0)}
            />
          </label>
          <label className="block text-[11px] text-text-muted">
            Thu nhập khác (₫)
            <input
              className={inp + " mt-1"}
              type="number"
              value={other}
              onChange={(e) => setOther(Number(e.target.value) || 0)}
            />
          </label>
          <label className="block text-[11px] text-text-muted">
            Số người phụ thuộc
            <input
              className={inp + " mt-1"}
              type="number"
              min={0}
              value={dependents}
              onChange={(e) => setDependents(Number(e.target.value) || 0)}
            />
          </label>
          {preview && (
            <div className="rounded-lg border border-border-subtle bg-surface-elevated p-3 text-[12px]">
              <div>BH bắt buộc: <strong>{fmtVnd(preview.income.mandatoryInsurance.total)}</strong></div>
              <div>Thuế TNCN: <strong>{fmtVnd(preview.income.personalIncomeTax)}</strong></div>
              <div>Thực nhận: <strong className="text-accent">{fmtVnd(preview.income.netTakeHome)}</strong></div>
            </div>
          )}
        </Panel>
      )}

      {step === 2 && (
        <Panel className="space-y-2 p-3">
          {expenses.map((ex, idx) => (
            <div key={ex.id} className="grid grid-cols-12 gap-1 items-center">
              <select
                className={inp + " col-span-3"}
                value={ex.category}
                onChange={(e) => {
                  const next = [...expenses];
                  next[idx] = { ...ex, category: e.target.value as ExpenseCategoryKey };
                  setExpenses(next);
                }}
              >
                {EXPENSE_CATS.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
              <input
                className={inp + " col-span-4"}
                value={ex.name}
                onChange={(e) => {
                  const next = [...expenses];
                  next[idx] = { ...ex, name: e.target.value };
                  setExpenses(next);
                }}
              />
              <input
                className={inp + " col-span-3"}
                type="number"
                value={ex.amount}
                onChange={(e) => {
                  const next = [...expenses];
                  next[idx] = { ...ex, amount: Number(e.target.value) || 0 };
                  setExpenses(next);
                }}
              />
              <label className="col-span-2 flex items-center gap-1 text-[10px] text-text-muted">
                <input
                  type="checkbox"
                  checked={ex.isFixed}
                  onChange={(e) => {
                    const next = [...expenses];
                    next[idx] = { ...ex, isFixed: e.target.checked };
                    setExpenses(next);
                  }}
                />
                Cố định
              </label>
            </div>
          ))}
          <button
            type="button"
            className="text-[12px] text-accent underline"
            onClick={() =>
              setExpenses([
                ...expenses,
                { id: uid("exp"), category: "other", name: "", amount: 0, isFixed: false },
              ])
            }
          >
            + Thêm khoản chi
          </button>
        </Panel>
      )}

      {step === 3 && (
        <Panel className="space-y-4 p-3">
          <div>
            <h3 className="mb-2 text-[12px] font-semibold">Tài sản</h3>
            {assets.map((a, idx) => (
              <div key={a.id} className="mb-1 grid grid-cols-12 gap-1">
                <select
                  className={inp + " col-span-3"}
                  value={a.category}
                  onChange={(e) => {
                    const next = [...assets];
                    next[idx] = { ...a, category: e.target.value as AssetCategoryKey };
                    setAssets(next);
                  }}
                >
                  {ASSET_CATS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
                <input
                  className={inp + " col-span-5"}
                  value={a.name}
                  onChange={(e) => {
                    const next = [...assets];
                    next[idx] = { ...a, name: e.target.value };
                    setAssets(next);
                  }}
                />
                <input
                  className={inp + " col-span-4"}
                  type="number"
                  value={a.balance}
                  onChange={(e) => {
                    const next = [...assets];
                    next[idx] = { ...a, balance: Number(e.target.value) || 0 };
                    setAssets(next);
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-[12px] text-accent underline"
              onClick={() =>
                setAssets([
                  ...assets,
                  {
                    id: uid("ast"),
                    category: "other",
                    name: "",
                    balance: 0,
                    updatedAt: new Date().toLocaleDateString("vi-VN"),
                  },
                ])
              }
            >
              + Thêm tài sản
            </button>
          </div>
          <div>
            <h3 className="mb-2 text-[12px] font-semibold">Nợ</h3>
            {debts.map((d, idx) => (
              <div key={d.id} className="mb-1 grid grid-cols-12 gap-1">
                <select
                  className={inp + " col-span-3"}
                  value={d.category}
                  onChange={(e) => {
                    const next = [...debts];
                    next[idx] = { ...d, category: e.target.value as DebtCategoryKey };
                    setDebts(next);
                  }}
                >
                  {DEBT_CATS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
                <input
                  className={inp + " col-span-3"}
                  value={d.name}
                  placeholder="Tên"
                  onChange={(e) => {
                    const next = [...debts];
                    next[idx] = { ...d, name: e.target.value };
                    setDebts(next);
                  }}
                />
                <input
                  className={inp + " col-span-2"}
                  type="number"
                  value={d.balance}
                  placeholder="Dư nợ"
                  onChange={(e) => {
                    const next = [...debts];
                    next[idx] = { ...d, balance: Number(e.target.value) || 0 };
                    setDebts(next);
                  }}
                />
                <input
                  className={inp + " col-span-2"}
                  type="number"
                  value={d.interestRate}
                  placeholder="%/năm"
                  onChange={(e) => {
                    const next = [...debts];
                    next[idx] = { ...d, interestRate: Number(e.target.value) || 0 };
                    setDebts(next);
                  }}
                />
                <input
                  className={inp + " col-span-2"}
                  type="number"
                  value={d.minMonthlyPayment}
                  placeholder="Trả/th"
                  onChange={(e) => {
                    const next = [...debts];
                    next[idx] = { ...d, minMonthlyPayment: Number(e.target.value) || 0 };
                    setDebts(next);
                  }}
                />
              </div>
            ))}
            <button
              type="button"
              className="text-[12px] text-accent underline"
              onClick={() =>
                setDebts([
                  ...debts,
                  {
                    id: uid("dbt"),
                    category: "consumer_loan",
                    name: "",
                    balance: 0,
                    interestRate: 12,
                    minMonthlyPayment: 0,
                    remainingMonths: 12,
                  },
                ])
              }
            >
              + Thêm nợ
            </button>
          </div>
        </Panel>
      )}

      {step === 4 && preview && (
        <Panel className="space-y-2 p-3 text-[12px]">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-border-subtle p-2">
              <div className="text-[10px] uppercase text-text-muted">Health</div>
              <div className="font-semibold">
                {preview.metrics.healthScore.total} — {preview.metrics.healthScore.ratingText}
              </div>
            </div>
            <div className="rounded-lg border border-border-subtle p-2">
              <div className="text-[10px] uppercase text-text-muted">Net worth</div>
              <div className="font-semibold">{fmtVnd(preview.metrics.netWorth)}</div>
            </div>
            <div className="rounded-lg border border-border-subtle p-2">
              <div className="text-[10px] uppercase text-text-muted">Thực nhận</div>
              <div className="font-semibold">{fmtVnd(preview.metrics.totalNetIncome)}</div>
            </div>
            <div className="rounded-lg border border-border-subtle p-2">
              <div className="text-[10px] uppercase text-text-muted">Tiết kiệm</div>
              <div className="font-semibold">{fmtVnd(preview.metrics.monthlySavings)}</div>
            </div>
          </div>
          <p className="text-[11px] text-text-muted">
            Lưu kỳ <strong>{period}</strong> vào localStorage. Không gửi server (W4).
          </p>
          {done && <p className="text-[12px] text-accent">Đã lưu — chuyển về tổng quan…</p>}
        </Panel>
      )}

      <div className="flex justify-between gap-2">
        <button
          type="button"
          disabled={step === 0}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-[12px] disabled:opacity-40"
        >
          Quay lại
        </button>
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-[12px] font-medium"
          >
            Tiếp
          </button>
        ) : (
          <button
            type="button"
            disabled={saving || !preview}
            onClick={save}
            className="rounded-lg border border-accent/40 bg-accent/15 px-3 py-1.5 text-[12px] font-medium disabled:opacity-40"
          >
            {saving ? "Đang lưu…" : "Lưu snapshot"}
          </button>
        )}
      </div>
    </div>
  );
}
