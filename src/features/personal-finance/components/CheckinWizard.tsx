import React, { useState, useEffect } from 'react';
import {
  MonthlySnapshot,
  FinanceProfile,
  ExpenseItem,
  AssetItem,
  DebtItem,
  FinancialGoal,
  ExpenseCategoryKey,
  AssetCategoryKey,
  DebtCategoryKey,
  GoalPriority,
} from '../types/finance.ts';
import { calculateTaxVn, TAX_PARAMS_2026 } from '../engines/taxVnEngine.ts';
import { calculateCashflow } from '../engines/cashflowEngine.ts';
import { calculateNetworth } from '../engines/networthEngine.ts';
import { calculateHealthScore } from '../engines/healthScoreEngine.ts';
import {
  CheckCircle2,
  Clock,
  ArrowRight,
  ArrowLeft,
  Copy,
  Plus,
  Trash2,
  Info,
  ShieldAlert,
  AlertTriangle,
  Wallet,
  PiggyBank,
  Check,
} from 'lucide-react';
import { OrcaMascot } from './OrcaMascot.tsx';

interface CheckinWizardProps {
  currentPeriod: string;
  profile: FinanceProfile;
  latestSnapshot?: MonthlySnapshot;
  onSaveSnapshot: (snapshot: MonthlySnapshot) => void;
  onCancel: () => void;
}

const EXPENSE_CATEGORIES: Array<{ key: ExpenseCategoryKey; label: string; defaultFixed: boolean }> = [
  { key: 'housing', label: '1. Nhà ở (Thuê nhà / phí quản lý / trả góp)', defaultFixed: true },
  { key: 'utilities', label: '2. Điện nước & viễn thông (Internet, 4G)', defaultFixed: true },
  { key: 'food', label: '3. Ăn uống (Thực phẩm gia đình, đi chợ, siêu thị)', defaultFixed: false },
  { key: 'transport', label: '4. Đi lại (Xăng xe, gửi xe, Grab, bảo dưỡng)', defaultFixed: false },
  { key: 'education', label: '5. Giáo dục & phát triển bản thân (Học phí, sách)', defaultFixed: true },
  { key: 'healthcare', label: '6. Y tế & chăm sóc sức khỏe (Thuốc, khám chữa)', defaultFixed: false },
  { key: 'insurance', label: '7. Bảo hiểm tự nguyện (Nhân thọ, sức khỏe)', defaultFixed: true },
  { key: 'entertainment', label: '8. Giải trí & giao lưu (Cafe, ăn ngoài, du lịch)', defaultFixed: false },
  { key: 'shopping', label: '9. Mua sắm cá nhân & gia dụng', defaultFixed: false },
  { key: 'family_support', label: '10. Hỗ trợ gia đình (Phụng dưỡng cha mẹ, người thân)', defaultFixed: true },
  { key: 'other', label: '11. Chi phí khác & dự phòng lặt vặt', defaultFixed: false },
];

const ASSET_TYPES: Array<{ key: AssetCategoryKey; label: string }> = [
  { key: 'cash', label: 'Tiền mặt & ví điện tử' },
  { key: 'savings', label: 'Tiền gửi tiết kiệm ngân hàng' },
  { key: 'gold', label: 'Vàng & kim loại quý' },
  { key: 'stocks', label: 'Cổ phiếu niêm yết' },
  { key: 'funds', label: 'Chứng chỉ quỹ mở / ETF' },
  { key: 'real_estate', label: 'Bất động sản' },
  { key: 'crypto', label: 'Tài sản số (Crypto)' },
  { key: 'other', label: 'Tài sản khác' },
];

const DEBT_TYPES: Array<{ key: DebtCategoryKey; label: string }> = [
  { key: 'credit_card', label: 'Thẻ tín dụng' },
  { key: 'mortgage', label: 'Vay mua nhà / Bất động sản' },
  { key: 'car_loan', label: 'Vay mua ô tô' },
  { key: 'consumer_loan', label: 'Vay tiêu dùng tín chấp' },
  { key: 'relative_loan', label: 'Vay người thân / bạn bè' },
  { key: 'other', label: 'Nợ khác' },
];

export const CheckinWizard: React.FC<CheckinWizardProps> = ({
  currentPeriod,
  profile,
  latestSnapshot,
  onSaveSnapshot,
  onCancel,
}) => {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [selectedPeriod, setSelectedPeriod] = useState<string>(currentPeriod);

  // Bước 1: Thu nhập
  const [grossSalary, setGrossSalary] = useState<number>(
    latestSnapshot ? latestSnapshot.income.grossSalary : 35000000
  );
  const [bonus, setBonus] = useState<number>(latestSnapshot ? latestSnapshot.income.bonus : 0);
  const [otherIncome, setOtherIncome] = useState<number>(
    latestSnapshot ? latestSnapshot.income.otherIncome : 0
  );
  const [insuranceSalaryBase, setInsuranceSalaryBase] = useState<number>(
    latestSnapshot ? latestSnapshot.income.insuranceSalaryBase : 35000000
  );
  const [dependentsCount, setDependentsCount] = useState<number>(profile.dependentsCount);

  // Bước 2: Chi tiêu
  const [expenses, setExpenses] = useState<ExpenseItem[]>(
    latestSnapshot && latestSnapshot.expenses.length > 0
      ? latestSnapshot.expenses
      : EXPENSE_CATEGORIES.map((c) => ({
          id: `exp-${c.key}`,
          category: c.key,
          name: c.label.split('.')[1].trim(),
          amount: c.key === 'housing' ? 8000000 : c.key === 'food' ? 6000000 : 1000000,
          isFixed: c.defaultFixed,
        }))
  );

  // Bước 3: Tài sản
  const [assets, setAssets] = useState<AssetItem[]>(
    latestSnapshot && latestSnapshot.assets.length > 0
      ? latestSnapshot.assets
      : [
          { id: 'ast-1', category: 'cash', name: 'Tài khoản thanh toán Techcombank', balance: 30000000, updatedAt: '05/10/2026' },
          { id: 'ast-2', category: 'savings', name: 'Sổ tiết kiệm VCB 6 tháng', balance: 80000000, updatedAt: '05/10/2026', interestRate: 4.8 },
          { id: 'ast-3', category: 'gold', name: '1 cây vàng nhẫn SJC 999.9', balance: 85000000, updatedAt: '05/10/2026' },
        ]
  );

  // Bước 4: Nợ
  const [debts, setDebts] = useState<DebtItem[]>(
    latestSnapshot && latestSnapshot.debts.length > 0
      ? latestSnapshot.debts
      : [
          { id: 'd-1', category: 'credit_card', name: 'Thẻ tín dụng VIB', balance: 5000000, interestRate: 24, minMonthlyPayment: 2000000, remainingMonths: 3 },
        ]
  );

  // Bước 5: Mục tiêu
  const [goals, setGoals] = useState<FinancialGoal[]>(
    latestSnapshot && latestSnapshot.goals.length > 0
      ? latestSnapshot.goals
      : [
          { id: 'g-1', name: 'Quỹ khẩn cấp 6 tháng', targetAmount: 100000000, accumulatedAmount: 80000000, deadline: '2027-06', priority: 'high', status: 'on_track' },
          { id: 'g-2', name: 'Tích lũy mua nhà', targetAmount: 800000000, accumulatedAmount: 150000000, deadline: '2029-12', priority: 'high', status: 'lagging' },
        ]
  );

  // Live tax calculation
  const taxCalc = calculateTaxVn(
    grossSalary,
    bonus,
    otherIncome,
    insuranceSalaryBase,
    dependentsCount,
    TAX_PARAMS_2026
  );

  // Live cashflow
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const fixedExpenses = expenses.filter((e) => e.isFixed).reduce((sum, e) => sum + e.amount, 0);
  const fixedCostRatio = taxCalc.netTakeHome > 0
    ? Number(((fixedExpenses / taxCalc.netTakeHome) * 100).toFixed(1))
    : 0;
  const monthlySavings = taxCalc.netTakeHome - totalExpenses;
  const savingsRate = taxCalc.netTakeHome > 0
    ? Number(((monthlySavings / taxCalc.netTakeHome) * 100).toFixed(1))
    : 0;

  // Prefill from previous month
  const handlePrefillPrevious = () => {
    if (!latestSnapshot) return;
    setGrossSalary(latestSnapshot.income.grossSalary);
    setBonus(latestSnapshot.income.bonus);
    setOtherIncome(latestSnapshot.income.otherIncome);
    setInsuranceSalaryBase(latestSnapshot.income.insuranceSalaryBase);
    setDependentsCount(latestSnapshot.profile.dependentsCount);
    setExpenses(latestSnapshot.expenses.map((e) => ({ ...e, id: `exp-${Date.now()}-${Math.random()}` })));
    setAssets(latestSnapshot.assets.map((a) => ({ ...a, id: `ast-${Date.now()}-${Math.random()}` })));
    setDebts(latestSnapshot.debts.map((d) => ({ ...d, id: `d-${Date.now()}-${Math.random()}` })));
    setGoals(latestSnapshot.goals.map((g) => ({ ...g, id: `g-${Date.now()}-${Math.random()}` })));
  };

  // Add / delete helpers
  const handleAddAsset = () => {
    const newAsset: AssetItem = {
      id: `ast-${Date.now()}`,
      category: 'savings',
      name: 'Tài sản mới',
      balance: 10000000,
      updatedAt: '05/10/2026',
    };
    setAssets([...assets, newAsset]);
  };

  const handleAddDebt = () => {
    const newDebt: DebtItem = {
      id: `d-${Date.now()}`,
      category: 'consumer_loan',
      name: 'Khoản vay mới',
      balance: 10000000,
      interestRate: 12.0,
      minMonthlyPayment: 1000000,
      remainingMonths: 12,
    };
    setDebts([...debts, newDebt]);
  };

  const handleAddGoal = () => {
    const newGoal: FinancialGoal = {
      id: `g-${Date.now()}`,
      name: 'Mục tiêu tài chính mới',
      targetAmount: 50000000,
      accumulatedAmount: 0,
      deadline: '2027-12',
      priority: 'medium',
      status: 'on_track',
    };
    setGoals([...goals, newGoal]);
  };

  // Hoàn tất và lưu
  const handleFinalize = () => {
    const updatedProfile: FinanceProfile = {
      ...profile,
      dependentsCount,
      updatedAt: new Date().toLocaleDateString('vi-VN'),
    };

    const networthRes = calculateNetworth(assets, debts);
    const cashflowRes = calculateCashflow(
      taxCalc.netTakeHome,
      expenses,
      networthRes.liquidAssets,
      selectedPeriod
    );

    const essentialMonthlyExpenses = cashflowRes.fixedExpenses + cashflowRes.variableExpenses * 0.5;
    const emergencyFundMonths = essentialMonthlyExpenses > 0
      ? Number((networthRes.liquidAssets / essentialMonthlyExpenses).toFixed(1))
      : 0;

    const totalMinDebtPayment = debts.reduce((sum, d) => sum + d.minMonthlyPayment, 0);
    const debtToIncomeRatio = taxCalc.netTakeHome > 0
      ? Number(((totalMinDebtPayment / taxCalc.netTakeHome) * 100).toFixed(1))
      : 0;

    const hasHighInterestDebt = debts.some((d) => d.balance > 0 && d.interestRate >= 12);
    const investedAssetsRatio = networthRes.totalAssets > 0
      ? Number(((networthRes.investedAssets / networthRes.totalAssets) * 100).toFixed(1))
      : 0;

    const healthRes = calculateHealthScore({
      netIncome: taxCalc.netTakeHome,
      savingsRate: cashflowRes.savingsRate,
      fixedCostRatio: cashflowRes.fixedCostRatio,
      emergencyFundMonths,
      totalDebt: networthRes.totalDebt,
      debtToIncomeRatio,
      hasHighInterestDebt,
      netWorth: networthRes.netWorth,
      investedAssetsRatio,
      hasRecentCheckin: true,
      consecutiveCheckinsCount: 3,
    });

    const newSnapshot: MonthlySnapshot = {
      period: selectedPeriod,
      profile: updatedProfile,
      income: {
        period: selectedPeriod,
        grossSalary,
        bonus,
        otherIncome,
        insuranceSalaryBase: taxCalc.insuranceSalaryBase,
        dependentsCount,
        mandatoryInsurance: taxCalc.mandatoryInsurance,
        personalIncomeTax: taxCalc.personalIncomeTax,
        netTakeHome: taxCalc.netTakeHome,
      },
      expenses,
      assets,
      debts,
      goals,
      metrics: {
        totalGrossIncome: taxCalc.totalGrossIncome,
        totalNetIncome: taxCalc.netTakeHome,
        totalExpenses: cashflowRes.totalExpenses,
        fixedExpenses: cashflowRes.fixedExpenses,
        variableExpenses: cashflowRes.variableExpenses,
        monthlySavings: cashflowRes.monthlySavings,
        savingsRate: cashflowRes.savingsRate,
        fixedCostRatio: cashflowRes.fixedCostRatio,
        totalAssets: networthRes.totalAssets,
        liquidAssets: networthRes.liquidAssets,
        investedAssets: networthRes.investedAssets,
        totalDebt: networthRes.totalDebt,
        netWorth: networthRes.netWorth,
        emergencyFundMonths,
        debtToIncomeRatio,
        healthScore: {
          total: healthRes.total,
          cashflowScore: healthRes.cashflowScore,
          emergencyScore: healthRes.emergencyScore,
          debtScore: healthRes.debtScore,
          networthScore: healthRes.networthScore,
          disciplineScore: healthRes.disciplineScore,
          ratingText: healthRes.ratingBand,
        },
      },
      engineVersion: 'orca-engine-v2026.1',
      timestamp: new Date().toISOString(),
      isDemo: false, // Dữ liệu người dùng tự nhập
    };

    onSaveSnapshot(newSnapshot);
  };

  return (
    <div className="bg-[#0b1530] border border-[#20366c] p-5 sm:p-6 rounded-2xl shadow-xl space-y-6">
      {/* Wizard Header Bar with Mascot */}
      <div className="flex flex-wrap items-center justify-between pb-4 border-b border-[#182852] gap-4">
        <div className="flex items-center gap-3.5">
          <OrcaMascot mood="saving" size={56} />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>📝 Monthly Check-in Kỳ {selectedPeriod}</span>
              </h2>
              <span className="bg-amber-950/60 text-amber-300 border border-amber-700/60 text-[10px] font-mono px-2.5 py-0.5 rounded-full font-bold">
                ~5 PHÚT
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Cùng bé Orca đi qua 5 bước nhỏ: Thu nhập & Thuế, Chi tiêu, Tài sản, Nợ và Mục tiêu nhen! 🐳
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {latestSnapshot && (
            <button
              onClick={handlePrefillPrevious}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#122248] hover:bg-[#1b3266] text-amber-300 border border-amber-700/60 text-xs font-mono rounded-xl transition-colors cursor-pointer"
              title="Kế thừa toàn bộ danh mục và số liệu từ tháng trước để chỉnh sửa nhanh"
            >
              <Copy className="w-3.5 h-3.5" />
              <span>Điền sẵn từ tháng trước (Prefill)</span>
            </button>
          )}

          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 bg-[#122248] text-slate-300 hover:text-white border border-[#2b4788] text-xs font-mono rounded-xl transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>

      {/* Steps Progress Tabs */}
      <div className="grid grid-cols-5 gap-1 text-xs">
        {[
          { num: 1, label: '1. Thu nhập & Thuế' },
          { num: 2, label: '2. Chi tiêu nhóm' },
          { num: 3, label: '3. Tài sản sở hữu' },
          { num: 4, label: '4. Dư nợ vay' },
          { num: 5, label: '5. Mục tiêu & Lưu' },
        ].map((s) => {
          const isDone = currentStep > s.num;
          const isCurrent = currentStep === s.num;
          return (
            <button
              key={s.num}
              onClick={() => setCurrentStep(s.num)}
              className={`p-2.5 text-left border transition-all cursor-pointer ${
                isCurrent
                  ? 'bg-[#101f3c] border-amber-500 text-amber-300 font-semibold'
                  : isDone
                  ? 'bg-[#0b1424] border-emerald-800/60 text-emerald-400'
                  : 'bg-[#070e1c] border-[#152340] text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px]">BƯỚC {s.num}</span>
                {isDone && <Check className="w-3 h-3 text-emerald-400" />}
              </div>
              <div className="truncate text-xs mt-0.5">{s.label}</div>
            </button>
          );
        })}
      </div>

      {/* ========================================================
          STEP 1: THU NHẬP & TÍNH THUẾ TNCN 2026
          ======================================================== */}
      {currentStep === 1 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Input fields */}
            <div className="space-y-4 bg-[#0a1222] border border-[#182b4c] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 border-b border-[#14233e] pb-2">
                1.1. KHAI BÁO THU NHẬP THÁNG NÀY (VND)
              </h3>

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Kỳ báo cáo (Tháng/Năm)
                </label>
                <input
                  type="text"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  placeholder="YYYY-MM (ví dụ: 2026-10)"
                  className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <div className="flex justify-between items-baseline mb-1">
                  <label className="text-xs font-semibold text-slate-300">
                    Lương gộp cơ bản (Gross Salary)
                  </label>
                  <div className="flex items-center gap-1">
                    {[1000000, 5000000, 10000000].map((delta) => (
                      <button
                        key={delta}
                        type="button"
                        onClick={() => {
                          const val = grossSalary + delta;
                          setGrossSalary(val);
                          setInsuranceSalaryBase(val);
                        }}
                        className="px-1.5 py-0.5 bg-[#0f1d38] hover:bg-[#182f5c] text-amber-300 text-[10px] font-mono rounded border border-amber-800/50 cursor-pointer"
                      >
                        +{delta / 1000000}M
                      </button>
                    ))}
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    value={grossSalary}
                    onChange={(e) => {
                      const val = Math.max(0, Number(e.target.value));
                      setGrossSalary(val);
                      setInsuranceSalaryBase(val);
                    }}
                    step="500000"
                    className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-2 text-xs font-mono text-amber-300 font-bold focus:border-amber-400 focus:outline-none rounded"
                  />
                  <span className="absolute right-3 top-2 text-xs text-slate-400 font-mono">
                    {new Intl.NumberFormat('vi-VN').format(grossSalary)} ₫
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  Thu nhập thỏa thuận trước khi khấu trừ bảo hiểm và thuế
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Thưởng dự án / KPI</label>
                  <input
                    type="number"
                    value={bonus}
                    onChange={(e) => setBonus(Math.max(0, Number(e.target.value)))}
                    step="500000"
                    className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none rounded"
                  />
                  <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                    {new Intl.NumberFormat('vi-VN').format(bonus)} ₫
                  </span>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1">Thu nhập phụ / khác</label>
                  <input
                    type="number"
                    value={otherIncome}
                    onChange={(e) => setOtherIncome(Math.max(0, Number(e.target.value)))}
                    step="500000"
                    className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none rounded"
                  />
                  <span className="text-[10px] text-slate-400 font-mono block mt-0.5">
                    {new Intl.NumberFormat('vi-VN').format(otherIncome)} ₫
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Mức lương làm căn cứ đóng BHXH (nếu khác lương gộp)
                </label>
                <input
                  type="number"
                  value={insuranceSalaryBase}
                  onChange={(e) => setInsuranceSalaryBase(Math.max(0, Number(e.target.value)))}
                  step="500000"
                  className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none rounded"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Trần đóng BHXH/BHYT: 46.800.000 ₫ (20 lần lương cơ sở 2,34 tr theo NĐ 73/2024/NĐ-CP)
                </p>
              </div>

              <div>
                <label className="block text-xs text-slate-300 mb-1">
                  Số người phụ thuộc đã đăng ký giảm trừ gia cảnh
                </label>
                <select
                  value={dependentsCount}
                  onChange={(e) => setDependentsCount(Number(e.target.value))}
                  className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-2 text-xs font-mono text-white focus:border-amber-400 focus:outline-none rounded"
                >
                  {[0, 1, 2, 3, 4, 5].map((cnt) => (
                    <option key={cnt} value={cnt}>
                      {cnt} người ({new Intl.NumberFormat('vi-VN').format(cnt * 6200000)} ₫/tháng)
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400 mt-1">
                  Mức giảm trừ: 6.200.000 ₫/người/tháng (theo dự thảo Luật Thuế TNCN 2026)
                </p>
              </div>
            </div>

            {/* Live Tax Engine Calculation Results Panel (B5: tax-vn) */}
            <div className="bg-[#0a1222] border border-[#182b4c] p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between border-b border-[#14233e] pb-2 mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                    1.2. KẾT QUẢ TÍNH TOÁN ENGINE TAX-VN (CHUẨN 2026)
                  </h3>
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-1.5 py-0.5 border border-emerald-700/60">
                    CÔNG THỨC CHÍNH THỨC
                  </span>
                </div>

                <div className="space-y-2 text-xs font-mono">
                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Tổng thu nhập Gross:</span>
                    <span className="text-white font-semibold">
                      {taxCalc.totalGrossIncome.toLocaleString('vi-VN')} ₫
                    </span>
                  </div>

                  {/* Mandatory Insurance Breakdown */}
                  <div className="py-1 border-b border-[#121f38]">
                    <div className="flex justify-between text-slate-300">
                      <span>Bảo hiểm bắt buộc (10.5%):</span>
                      <span className="text-rose-400 font-semibold">
                        -{taxCalc.mandatoryInsurance.total.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 pl-2 mt-0.5 space-y-0.5">
                      <div className="flex justify-between">
                        <span>• BHXH (8%):</span>
                        <span>{taxCalc.mandatoryInsurance.bhxh.toLocaleString('vi-VN')} ₫</span>
                      </div>
                      <div className="flex justify-between">
                        <span>• BHYT (1.5%):</span>
                        <span>{taxCalc.mandatoryInsurance.bhyt.toLocaleString('vi-VN')} ₫</span>
                      </div>
                      <div className="flex justify-between">
                        <span>• BHTN (1%):</span>
                        <span>{taxCalc.mandatoryInsurance.bhtn.toLocaleString('vi-VN')} ₫</span>
                      </div>
                      {taxCalc.mandatoryInsurance.isCapped && (
                        <div className="text-amber-400 text-[10px]">
                          [!] Đã áp dụng mức trần đóng bảo hiểm tối đa.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Allowances */}
                  <div className="py-1 border-b border-[#121f38]">
                    <div className="flex justify-between text-slate-300">
                      <span>Giảm trừ gia cảnh:</span>
                      <span className="text-emerald-400 font-semibold">
                        {taxCalc.totalAllowances.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 pl-2 mt-0.5">
                      <div>• Bản thân: 15.500.000 ₫/tháng</div>
                      <div>
                        • Người phụ thuộc: {dependentsCount} x 6.200.000 ={' '}
                        {(dependentsCount * 6200000).toLocaleString('vi-VN')} ₫
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Thu nhập tính thuế:</span>
                    <span className="text-slate-200">
                      {taxCalc.taxableIncome.toLocaleString('vi-VN')} ₫
                    </span>
                  </div>

                  {/* PIT Tax Amount */}
                  <div className="flex justify-between py-1.5 border-b border-[#14233e] bg-[#0c1628] px-2">
                    <span className="text-amber-300 font-semibold">
                      Thuế TNCN (5 bậc 2026):
                    </span>
                    <span className="text-rose-400 font-bold">
                      -{taxCalc.personalIncomeTax.toLocaleString('vi-VN')} ₫
                    </span>
                  </div>

                  {/* Net Take-home Pay */}
                  <div className="p-3 bg-gradient-to-r from-[#122344] to-[#182f5c] border border-amber-500/50 mt-3">
                    <div className="text-[11px] text-amber-300 uppercase tracking-wider">
                      THU NHẬP THỰC NHẬN (NET TAKE-HOME):
                    </div>
                    <div className="text-2xl font-bold text-white mt-0.5">
                      {taxCalc.netTakeHome.toLocaleString('vi-VN')} ₫
                    </div>
                    <div className="text-[10px] text-slate-300 mt-1 flex justify-between">
                      <span>Thuế suất thực tế: {taxCalc.effectiveTaxRate}%</span>
                      <span>Tổng khấu trừ: {taxCalc.effectiveDeductionsRate}%</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-2.5 bg-[#070e1c] border border-[#162646] text-[10px] text-slate-400">
                <strong>Căn cứ pháp lý:</strong> Giảm trừ gia cảnh 15,5 triệu đồng và 6,2 triệu đồng theo dự thảo Luật Thuế TNCN sửa đổi hiệu lực 2026. Lương 17 tr/tháng không có người phụ thuộc: Thuế TNCN = 0 ₫.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          STEP 2: CHI TIÊU THEO 11 NHÓM CHUẨN (CỐ ĐỊNH / BIẾN ĐỔI)
          ======================================================== */}
      {currentStep === 2 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between pb-2 border-b border-[#14233e]">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                2. CHI TIÊU THEO NHÓM (11 NHÓM CHUẨN VÀ ĐÁNH DẤU CỐ ĐỊNH / BIẾN ĐỔI)
              </h3>
              <p className="text-[11px] text-slate-400">
                Đánh dấu các khoản chi cố định (bắt buộc trả hàng tháng) để kiểm soát trần an toàn &le; 65% thu nhập thực nhận.
              </p>
            </div>

            <div className="flex items-center gap-4 text-xs font-mono">
              <div>
                <span className="text-slate-400">Tổng chi: </span>
                <span className="text-white font-bold">{totalExpenses.toLocaleString('vi-VN')} ₫</span>
              </div>
              <div>
                <span className="text-slate-400">Chi cố định: </span>
                <span className={`font-bold ${fixedCostRatio > 65 ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {fixedCostRatio}% ({fixedExpenses.toLocaleString('vi-VN')} ₫)
                </span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
            {expenses.map((exp, idx) => (
              <div
                key={exp.id || idx}
                className="bg-[#0a1222] border border-[#182b4c] p-3 flex flex-col justify-between"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-slate-200 truncate">
                    {exp.name}
                  </span>
                  <button
                    onClick={() => {
                      const updated = [...expenses];
                      updated[idx].isFixed = !updated[idx].isFixed;
                      setExpenses(updated);
                    }}
                    className={`px-2 py-0.5 text-[10px] font-mono cursor-pointer border transition-colors ${
                      exp.isFixed
                        ? 'bg-amber-950/70 border-amber-600 text-amber-300'
                        : 'bg-cyan-950/70 border-cyan-600 text-cyan-300'
                    }`}
                  >
                    {exp.isFixed ? 'CỐ ĐỊNH' : 'BIẾN ĐỔI'}
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      type="number"
                      step="100000"
                      value={exp.amount}
                      onChange={(e) => {
                        const updated = [...expenses];
                        updated[idx].amount = Math.max(0, Number(e.target.value));
                        setExpenses(updated);
                      }}
                      className="w-full bg-[#060b14] border border-[#1e335b] px-2.5 py-1.5 text-xs font-mono text-white focus:border-amber-400 focus:outline-none"
                    />
                    <span className="absolute right-2 top-1.5 text-xs text-slate-500 font-mono">₫</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================
          STEP 3: TÀI SẢN SỞ HỮU (KHÔNG LƯU SỐ TÀI KHOẢN)
          ======================================================== */}
      {currentStep === 3 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between pb-2 border-b border-[#14233e]">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                3. TÀI SẢN (TIỀN MẶT, TIỀN GỬI, VÀNG, CHỨNG KHOÁN, BẤT ĐỘNG SẢN, CRYPTO)
              </h3>
              <p className="text-[11px] text-slate-400">
                Tuân thủ B5/B7: Chỉ lưu số dư và tên phân loại, tuyệt đối không lưu số tài khoản ngân hàng.
              </p>
            </div>

            <button
              onClick={handleAddAsset}
              className="flex items-center gap-1 px-3 py-1 bg-[#101f3c] text-amber-300 border border-amber-700/60 hover:bg-[#162a52] text-xs font-mono transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm tài sản</span>
            </button>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {assets.map((asset, idx) => (
              <div
                key={asset.id || idx}
                className="bg-[#0a1222] border border-[#182b4c] p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
              >
                <div className="sm:col-span-3">
                  <select
                    value={asset.category}
                    onChange={(e) => {
                      const updated = [...assets];
                      updated[idx].category = e.target.value as AssetCategoryKey;
                      setAssets(updated);
                    }}
                    className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
                  >
                    {ASSET_TYPES.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-4">
                  <input
                    type="text"
                    value={asset.name}
                    onChange={(e) => {
                      const updated = [...assets];
                      updated[idx].name = e.target.value;
                      setAssets(updated);
                    }}
                    placeholder="Tên tài sản / Nơi giữ"
                    className="w-full bg-[#060b14] border border-[#1e335b] px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-4 relative">
                  <input
                    type="number"
                    step="1000000"
                    value={asset.balance}
                    onChange={(e) => {
                      const updated = [...assets];
                      updated[idx].balance = Math.max(0, Number(e.target.value));
                      setAssets(updated);
                    }}
                    className="w-full bg-[#060b14] border border-[#1e335b] px-2.5 py-1.5 text-xs font-mono text-amber-300 font-bold focus:outline-none"
                  />
                  <span className="absolute right-2 top-1.5 text-xs text-slate-500 font-mono">₫</span>
                </div>

                <div className="sm:col-span-1 flex justify-end">
                  <button
                    onClick={() => {
                      setAssets(assets.filter((_, i) => i !== idx));
                    }}
                    className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Xóa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========================================================
          STEP 4: DƯ NỢ VAY & LÃI SUẤT
          ======================================================== */}
      {currentStep === 4 && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between pb-2 border-b border-[#14233e]">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                4. DƯ NỢ VAY (THẺ TÍN DỤNG, VAY MUA NHÀ, XE, TIÊU DÙNG)
              </h3>
              <p className="text-[11px] text-slate-400">
                Nhập chính xác lãi suất để engine tính chiến lược trả nợ Avalanche và Snowball tối ưu.
              </p>
            </div>

            <button
              onClick={handleAddDebt}
              className="flex items-center gap-1 px-3 py-1 bg-[#101f3c] text-amber-300 border border-amber-700/60 hover:bg-[#162a52] text-xs font-mono transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm khoản nợ</span>
            </button>
          </div>

          {debts.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-[#0a1222] border border-[#182b4c]">
              <p className="font-semibold text-emerald-400 mb-1">
                Tuyệt vời! Hiện tại bạn không có dư nợ vay nào.
              </p>
              <p className="text-slate-500">
                Nếu có phát sinh nợ thẻ tín dụng hoặc trả góp, nhấn nút Thêm khoản nợ ở trên.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
              {debts.map((debt, idx) => (
                <div
                  key={debt.id || idx}
                  className="bg-[#0a1222] border border-[#182b4c] p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
                >
                  <div className="sm:col-span-3">
                    <select
                      value={debt.category}
                      onChange={(e) => {
                        const updated = [...debts];
                        updated[idx].category = e.target.value as DebtCategoryKey;
                        setDebts(updated);
                      }}
                      className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1.5 text-xs text-slate-200 focus:outline-none"
                    >
                      {DEBT_TYPES.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="sm:col-span-3">
                    <input
                      type="text"
                      value={debt.name}
                      onChange={(e) => {
                        const updated = [...debts];
                        updated[idx].name = e.target.value;
                        setDebts(updated);
                      }}
                      placeholder="Tên khoản nợ"
                      className="w-full bg-[#060b14] border border-[#1e335b] px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-slate-500 block">Dư nợ</label>
                    <input
                      type="number"
                      step="500000"
                      value={debt.balance}
                      onChange={(e) => {
                        const updated = [...debts];
                        updated[idx].balance = Math.max(0, Number(e.target.value));
                        setDebts(updated);
                      }}
                      className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1 text-xs font-mono text-rose-400 font-bold focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <label className="text-[10px] text-slate-500 block">Lãi suất %/năm</label>
                    <input
                      type="number"
                      step="0.5"
                      value={debt.interestRate}
                      onChange={(e) => {
                        const updated = [...debts];
                        updated[idx].interestRate = Number(e.target.value);
                        setDebts(updated);
                      }}
                      className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-1">
                    <label className="text-[10px] text-slate-500 block">Trả tối thiểu</label>
                    <input
                      type="number"
                      step="500000"
                      value={debt.minMonthlyPayment}
                      onChange={(e) => {
                        const updated = [...debts];
                        updated[idx].minMonthlyPayment = Math.max(0, Number(e.target.value));
                        setDebts(updated);
                      }}
                      className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1 text-xs font-mono text-white focus:outline-none"
                    />
                  </div>

                  <div className="sm:col-span-1 flex justify-end">
                    <button
                      onClick={() => setDebts(debts.filter((_, i) => i !== idx))}
                      className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                      title="Xóa"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          STEP 5: MỤC TIÊU TÀI CHÍNH & TỔNG KẾT LƯU SNAPSHOT
          ======================================================== */}
      {currentStep === 5 && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between pb-2 border-b border-[#14233e]">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                5. MỤC TIÊU TÀI CHÍNH (TIẾN ĐỘ & SỐ ĐÃ TÍCH LŨY)
              </h3>
              <p className="text-[11px] text-slate-400">
                Engine sẽ tự động phát hiện mục tiêu bị chậm trễ tiến độ trên 10% để đưa ra khuyến nghị.
              </p>
            </div>

            <button
              onClick={handleAddGoal}
              className="flex items-center gap-1 px-3 py-1 bg-[#101f3c] text-amber-300 border border-amber-700/60 hover:bg-[#162a52] text-xs font-mono transition-colors cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Thêm mục tiêu</span>
            </button>
          </div>

          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
            {goals.map((goal, idx) => (
              <div
                key={goal.id || idx}
                className="bg-[#0a1222] border border-[#182b4c] p-3 grid grid-cols-1 sm:grid-cols-12 gap-3 items-center"
              >
                <div className="sm:col-span-4">
                  <label className="text-[10px] text-slate-500 block">Tên mục tiêu</label>
                  <input
                    type="text"
                    value={goal.name}
                    onChange={(e) => {
                      const updated = [...goals];
                      updated[idx].name = e.target.value;
                      setGoals(updated);
                    }}
                    className="w-full bg-[#060b14] border border-[#1e335b] px-2.5 py-1 text-xs text-white focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="text-[10px] text-slate-500 block">Số tiền cần (₫)</label>
                  <input
                    type="number"
                    step="5000000"
                    value={goal.targetAmount}
                    onChange={(e) => {
                      const updated = [...goals];
                      updated[idx].targetAmount = Math.max(0, Number(e.target.value));
                      setGoals(updated);
                    }}
                    className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1 text-xs font-mono text-white focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-3">
                  <label className="text-[10px] text-slate-500 block">Đã tích lũy (₫)</label>
                  <input
                    type="number"
                    step="1000000"
                    value={goal.accumulatedAmount}
                    onChange={(e) => {
                      const updated = [...goals];
                      updated[idx].accumulatedAmount = Math.max(0, Number(e.target.value));
                      setGoals(updated);
                    }}
                    className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1 text-xs font-mono text-emerald-400 font-bold focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-1">
                  <label className="text-[10px] text-slate-500 block">Hạn (YYYY-MM)</label>
                  <input
                    type="text"
                    value={goal.deadline}
                    onChange={(e) => {
                      const updated = [...goals];
                      updated[idx].deadline = e.target.value;
                      setGoals(updated);
                    }}
                    className="w-full bg-[#060b14] border border-[#1e335b] px-2 py-1 text-xs font-mono text-white focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-1 flex justify-end">
                  <button
                    onClick={() => setGoals(goals.filter((_, i) => i !== idx))}
                    className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                    title="Xóa"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Quick Review Box */}
          <div className="bg-[#0b1424] border border-[#1d325a] p-4 text-xs">
            <h4 className="font-semibold text-amber-400 uppercase tracking-wider mb-2">
              XÁC NHẬN CHỈ SỐ KỲ BÁO CÁO {selectedPeriod}:
            </h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono">
              <div className="p-2 bg-[#070e1c] border border-[#162646]">
                <div className="text-[10px] text-slate-400">Thu nhập Net:</div>
                <div className="font-bold text-white text-sm">
                  {taxCalc.netTakeHome.toLocaleString('vi-VN')} ₫
                </div>
              </div>
              <div className="p-2 bg-[#070e1c] border border-[#162646]">
                <div className="text-[10px] text-slate-400">Tổng chi tiêu:</div>
                <div className="font-bold text-white text-sm">
                  {totalExpenses.toLocaleString('vi-VN')} ₫
                </div>
              </div>
              <div className="p-2 bg-[#070e1c] border border-[#162646]">
                <div className="text-[10px] text-slate-400">Tiết kiệm tháng:</div>
                <div className="font-bold text-emerald-400 text-sm">
                  {monthlySavings.toLocaleString('vi-VN')} ₫ ({savingsRate}%)
                </div>
              </div>
              <div className="p-2 bg-[#070e1c] border border-[#162646]">
                <div className="text-[10px] text-slate-400">Chi cố định:</div>
                <div className={`font-bold text-sm ${fixedCostRatio > 65 ? 'text-rose-400' : 'text-slate-200'}`}>
                  {fixedCostRatio}% (Trần 65%)
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Navigation Wizard Action Buttons */}
      <div className="pt-4 border-t border-[#14233e] flex items-center justify-between">
        <div>
          {currentStep > 1 && (
            <button
              onClick={() => setCurrentStep(currentStep - 1)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0e1a33] text-slate-300 hover:text-white border border-[#233a69] text-xs font-mono transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Bước trước</span>
            </button>
          )}
        </div>

        <div>
          {currentStep < 5 ? (
            <button
              onClick={() => setCurrentStep(currentStep + 1)}
              className="flex items-center gap-1.5 px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-xs transition-all cursor-pointer shadow-sm"
            >
              <span>Tiếp tục: Bước {currentStep + 1}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleFinalize}
              className="flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-slate-950 font-bold text-xs transition-all cursor-pointer shadow-md"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>HOÀN TẤT & LƯU BẢN CHỤP THÁNG</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
