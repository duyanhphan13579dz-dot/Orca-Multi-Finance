import React, { useState, useEffect } from 'react';
import { calculateTaxVn, TAX_PARAMS_2026 } from '../engines/taxVnEngine.ts';
import { calculateCashflow } from '../engines/cashflowEngine.ts';
import { formatVND, formatNumberVi } from '../utils/formatters.ts';
import { ExpenseItem, MonthlySnapshot } from '../types/finance.ts';
import { OrcaMascot } from './OrcaMascot.tsx';
import {
  Calculator,
  PiggyBank,
  CheckCircle2,
  RotateCcw,
  Plus,
  Trash2,
  Save,
  Sparkles,
  Heart,
  ArrowRight,
} from 'lucide-react';

interface QuickCashflowCalculatorProps {
  currentSnapshot: MonthlySnapshot;
  onApplyCashflowToSnapshot: (params: {
    grossSalary: number;
    bonus: number;
    otherIncome: number;
    insuranceSalaryBase: number;
    dependentsCount: number;
    expenses: ExpenseItem[];
  }) => void;
}

export const QuickCashflowCalculator: React.FC<QuickCashflowCalculatorProps> = ({
  currentSnapshot,
  onApplyCashflowToSnapshot,
}) => {
  // Input states
  const [grossSalary, setGrossSalary] = useState<number>(currentSnapshot.income.grossSalary);
  const [bonus, setBonus] = useState<number>(currentSnapshot.income.bonus || 0);
  const [otherIncome, setOtherIncome] = useState<number>(currentSnapshot.income.otherIncome || 0);
  const [insuranceSalaryBase, setInsuranceSalaryBase] = useState<number>(
    currentSnapshot.income.insuranceSalaryBase || currentSnapshot.income.grossSalary
  );
  const [dependentsCount, setDependentsCount] = useState<number>(
    currentSnapshot.income.dependentsCount || 0
  );

  const [expenses, setExpenses] = useState<ExpenseItem[]>(currentSnapshot.expenses);
  const [appliedNotification, setAppliedNotification] = useState<boolean>(false);

  // Synchronize when currentSnapshot changes
  useEffect(() => {
    // This form must reset its editable fields when the selected month changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGrossSalary(currentSnapshot.income.grossSalary);
    setBonus(currentSnapshot.income.bonus || 0);
    setOtherIncome(currentSnapshot.income.otherIncome || 0);
    setInsuranceSalaryBase(
      currentSnapshot.income.insuranceSalaryBase || currentSnapshot.income.grossSalary
    );
    setDependentsCount(currentSnapshot.income.dependentsCount || 0);
    setExpenses(currentSnapshot.expenses);
  }, [currentSnapshot]);

  // Live calculation results
  const taxResult = calculateTaxVn(
    grossSalary,
    bonus,
    otherIncome,
    insuranceSalaryBase,
    dependentsCount,
    TAX_PARAMS_2026
  );

  const cashflowResult = calculateCashflow(
    taxResult.netTakeHome,
    expenses,
    currentSnapshot.metrics.liquidAssets,
    currentSnapshot.period
  );

  // Quick salary adder
  const handleQuickAddSalary = (delta: number) => {
    const updated = Math.max(0, grossSalary + delta);
    setGrossSalary(updated);
    if (insuranceSalaryBase === grossSalary) {
      setInsuranceSalaryBase(updated);
    }
  };

  // Add new expense row
  const handleAddExpenseRow = () => {
    const newRow: ExpenseItem = {
      id: `exp-${Date.now()}`,
      category: 'other',
      name: 'Khoản chi mới',
      amount: 1000000,
      isFixed: false,
    };
    setExpenses([...expenses, newRow]);
  };

  // Apply changes to snapshot
  const handleApply = () => {
    onApplyCashflowToSnapshot({
      grossSalary,
      bonus,
      otherIncome,
      insuranceSalaryBase,
      dependentsCount,
      expenses,
    });
    setAppliedNotification(true);
    setTimeout(() => setAppliedNotification(false), 3000);
  };

  // Reset to original snapshot
  const handleReset = () => {
    setGrossSalary(currentSnapshot.income.grossSalary);
    setBonus(currentSnapshot.income.bonus || 0);
    setOtherIncome(currentSnapshot.income.otherIncome || 0);
    setInsuranceSalaryBase(
      currentSnapshot.income.insuranceSalaryBase || currentSnapshot.income.grossSalary
    );
    setDependentsCount(currentSnapshot.income.dependentsCount || 0);
    setExpenses(currentSnapshot.expenses);
  };

  // Mascot mood based on savings & expenses
  const mascotMood = cashflowResult.savingsRate >= 20
    ? 'cheering'
    : cashflowResult.fixedCostRatio > 65
    ? 'caution'
    : 'calculating';

  // Super cute voice from Bé Orca
  const mascotBubble = cashflowResult.savingsRate >= 20
    ? `Oa! Tháng này cậu để dành được tận ${cashflowResult.savingsRate}% lương (${formatVND(cashflowResult.monthlySavings)}) lận nè! Bé Orca vỗ tay khen cậu nhen! 🐳💖`
    : cashflowResult.fixedCostRatio > 65
    ? `Cậu ơi, Bé Orca thấy chi tiêu cố định hơi cao một xíu (${cashflowResult.fixedCostRatio}%). Mình cùng để ý nhẹ nhen~ ✨`
    : `Bé Orca tính thử cho cậu rồi đó: Lương về ví sau thuế và bảo hiểm là ${formatVND(taxResult.netTakeHome)} nhen! Cậu xem có đúng chưa nè? 🐳`;

  return (
    <div className="bg-[#12224d] border border-[#2c4c96] p-5 sm:p-6 rounded-2xl shadow-xl space-y-6">
      {/* Header with Adorable Bé Orca */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#243f7d]">
        <div className="flex items-center gap-4">
          <OrcaMascot mood={mascotMood} size={82} bubbleText={mascotBubble} />
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white tracking-wide flex items-center gap-2">
              <span>⚡ Bảng Tính Dòng Tiền & Thuế Cùng Bé Orca</span>
            </h2>
            <p className="text-xs text-sky-200 mt-1">
              Cậu nhập lương và chi tiêu vào đây nhé, Bé Orca tính ngay tiền về ví và heo đất giúp cậu nè! 🐳
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#172a5a] hover:bg-[#203a7c] text-slate-200 border border-[#31539e] text-xs font-mono rounded-xl transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Khôi phục</span>
          </button>

          <button
            onClick={handleApply}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-md hover:scale-105"
          >
            <Save className="w-4 h-4" />
            <span>Lưu vào sổ kỳ {currentSnapshot.period} 🐳</span>
          </button>
        </div>
      </div>

      {appliedNotification && (
        <div className="p-3.5 bg-emerald-900/90 border border-emerald-400 text-emerald-100 text-xs font-medium rounded-xl flex items-center gap-2 shadow-lg animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" />
          <span>Bé Orca đã lưu số liệu mới vào sổ kỳ {currentSnapshot.period} cho cậu rồi nè! Mọi báo cáo đã tự động cập nhật nhé! ✨</span>
        </div>
      )}

      {/* Main Grid: Inputs on Left, Realtime Output Card on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: INPUTS (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          {/* Section A: Thu nhập */}
          <div className="bg-[#172a5a] border border-[#2b4b96] p-4 rounded-2xl space-y-3.5 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-[#243e7c]">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>💵</span>
                <span>1. CÁC KHOẢN THU NHẬP CỦA CẬU</span>
              </span>
              <span className="text-xs font-mono text-slate-200">
                Lương Gross: <strong className="text-amber-300 font-bold">{formatVND(taxResult.totalGrossIncome)}</strong>
              </span>
            </div>

            <div>
              <div className="flex justify-between items-baseline mb-1.5">
                <label className="text-xs font-bold text-slate-100">
                  Lương gộp (Gross Salary)
                </label>
                <div className="flex items-center gap-1">
                  {[1000000, 5000000, 10000000].map((inc) => (
                    <button
                      key={inc}
                      onClick={() => handleQuickAddSalary(inc)}
                      className="px-2 py-0.5 bg-[#1f3775] hover:bg-[#284898] text-amber-300 text-[10px] font-mono rounded-lg border border-amber-400/40 cursor-pointer transition-all"
                    >
                      +{inc / 1000000}M
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
                  className="w-full bg-[#0f1d44] border border-[#3357ac] focus:border-amber-400 px-3 py-2 text-sm font-mono font-bold text-amber-300 rounded-xl outline-none"
                />
                <span className="absolute right-3 top-2 text-xs text-slate-300 font-mono">
                  {formatVND(grossSalary)}
                </span>
              </div>

              {/* Quick Salary Presets */}
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                <span className="text-[10px] text-slate-300 font-mono">Gợi ý nhanh:</span>
                {[
                  { label: '12M (Khởi đầu)', val: 12000000 },
                  { label: '20M (Văn phòng)', val: 20000000 },
                  { label: '35M (Thu nhập tốt)', val: 35000000 },
                  { label: '50M (Quản lý)', val: 50000000 },
                ].map((preset) => (
                  <button
                    key={preset.val}
                    onClick={() => {
                      setGrossSalary(preset.val);
                      setInsuranceSalaryBase(preset.val);
                    }}
                    className="px-2 py-0.5 bg-[#172c63] hover:bg-[#203c86] text-sky-200 hover:text-white text-[10px] font-mono rounded-lg border border-sky-400/30 cursor-pointer transition-all"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-200 block mb-1">Thưởng tháng / KPI 🎉</label>
                <input
                  type="number"
                  value={bonus}
                  onChange={(e) => setBonus(Math.max(0, Number(e.target.value)))}
                  step="500000"
                  className="w-full bg-[#0f1d44] border border-[#3357ac] focus:border-amber-400 px-3 py-2 text-xs font-mono text-white rounded-xl outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-200 block mb-1">Thu nhập phụ / làm thêm 💼</label>
                <input
                  type="number"
                  value={otherIncome}
                  onChange={(e) => setOtherIncome(Math.max(0, Number(e.target.value)))}
                  step="500000"
                  className="w-full bg-[#0f1d44] border border-[#3357ac] focus:border-amber-400 px-3 py-2 text-xs font-mono text-white rounded-xl outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#243e7c] text-xs">
              <div>
                <label className="text-slate-300 block mb-1 text-[11px] font-medium">
                  Người phụ thuộc (con cái / cha mẹ)
                </label>
                <select
                  value={dependentsCount}
                  onChange={(e) => setDependentsCount(Number(e.target.value))}
                  className="w-full bg-[#0f1d44] border border-[#3357ac] px-2.5 py-2 text-xs font-mono text-white rounded-xl outline-none cursor-pointer"
                >
                  {[0, 1, 2, 3, 4, 5].map((num) => (
                    <option key={num} value={num}>
                      {num} người (giảm {formatVND(num * 6200000)}/tháng)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-300 block mb-1 text-[11px] font-medium">
                  Mức đóng BHXH (Trần 46,8 tr)
                </label>
                <input
                  type="number"
                  value={insuranceSalaryBase}
                  onChange={(e) => setInsuranceSalaryBase(Math.max(0, Number(e.target.value)))}
                  step="500000"
                  className="w-full bg-[#0f1d44] border border-[#3357ac] px-2.5 py-2 text-xs font-mono text-white rounded-xl outline-none"
                />
              </div>
            </div>
          </div>

          {/* Section B: Chi tiêu theo các khoản chính */}
          <div className="bg-[#172a5a] border border-[#2b4b96] p-4 rounded-2xl space-y-3 shadow-sm">
            <div className="flex items-center justify-between pb-2 border-b border-[#243e7c]">
              <span className="text-xs font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🛒</span>
                <span>2. CÁC KHOẢN CHI TIÊU ({expenses.length} KHOẢN)</span>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleAddExpenseRow}
                  className="flex items-center gap-1 px-2.5 py-1 bg-[#1f3875] hover:bg-[#294a9a] text-sky-200 border border-sky-400/40 text-[11px] font-mono rounded-lg cursor-pointer transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Thêm khoản</span>
                </button>
                <span className="text-xs font-mono text-slate-200">
                  Tổng: <strong className="text-white font-bold">{formatVND(cashflowResult.totalExpenses)}</strong>
                </span>
              </div>
            </div>

            <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
              {expenses.map((exp, idx) => (
                <div
                  key={exp.id || idx}
                  className="p-2.5 bg-[#0f1d44] border border-[#264182] rounded-xl flex items-center justify-between gap-2 text-xs hover:border-[#385cb5] transition-colors"
                >
                  <input
                    type="text"
                    value={exp.name}
                    onChange={(e) => {
                      const updated = [...expenses];
                      updated[idx].name = e.target.value;
                      setExpenses(updated);
                    }}
                    className="flex-1 bg-transparent border-b border-transparent hover:border-slate-400 focus:border-amber-400 text-slate-100 font-medium px-1 py-0.5 outline-none truncate"
                  />

                  {/* Fixed / Variable Toggle */}
                  <button
                    onClick={() => {
                      const updated = [...expenses];
                      updated[idx].isFixed = !updated[idx].isFixed;
                      setExpenses(updated);
                    }}
                    className={`px-2.5 py-1 text-[10px] font-mono rounded-lg border transition-all cursor-pointer shrink-0 font-bold ${
                      exp.isFixed
                        ? 'bg-amber-400/20 border-amber-400 text-amber-300'
                        : 'bg-sky-400/20 border-sky-400 text-sky-200'
                    }`}
                    title="Bấm để đổi thành Cố định (tiền nhà, hóa đơn) hoặc Biến đổi (ăn uống, mua sắm)"
                  >
                    {exp.isFixed ? '📌 CỐ ĐỊNH' : '🌊 BIẾN ĐỔI'}
                  </button>

                  <div className="w-32 relative shrink-0">
                    <input
                      type="number"
                      step="100000"
                      value={exp.amount}
                      onChange={(e) => {
                        const updated = [...expenses];
                        updated[idx].amount = Math.max(0, Number(e.target.value));
                        setExpenses(updated);
                      }}
                      className="w-full bg-[#172a5a] border border-[#3357ac] focus:border-amber-400 px-2 py-1 text-xs font-mono text-right text-white rounded-lg outline-none font-bold"
                    />
                  </div>

                  <button
                    onClick={() => setExpenses(expenses.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-rose-400 p-1 cursor-pointer shrink-0 transition-colors"
                    title="Xóa khoản chi này"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: REALTIME CALCULATION RESULTS (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#172a5a] border-2 border-amber-400 p-5 rounded-2xl space-y-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-[#243e7c]">
              <span className="text-xs font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-amber-400" />
                BẢNG TÍNH THỰC NHẬN CỦA BÉ ORCA
              </span>
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950 px-2.5 py-0.5 rounded-full border border-emerald-400/50 font-bold">
                ✓ CHUẨN 2026
              </span>
            </div>

            {/* Income breakdown */}
            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between py-1 text-slate-200 border-b border-[#243e7c]">
                <span>Tổng lương Gross:</span>
                <span className="font-bold text-white">{formatVND(taxResult.totalGrossIncome)}</span>
              </div>

              <div className="flex justify-between py-1 text-slate-300 border-b border-[#243e7c]">
                <span>Bảo hiểm bắt buộc (10.5%):</span>
                <span className="text-rose-300 font-semibold">
                  -{formatVND(taxResult.mandatoryInsurance.total)}
                </span>
              </div>

              <div className="flex justify-between py-1 text-slate-300 border-b border-[#243e7c]">
                <span>Giảm trừ gia cảnh (15,5tr + 6,2tr):</span>
                <span className="text-emerald-300 font-semibold">
                  {formatVND(taxResult.totalAllowances)}
                </span>
              </div>

              <div className="flex justify-between py-1 text-slate-300 border-b border-[#243e7c]">
                <span>Thu nhập tính thuế:</span>
                <span className="text-slate-100">{formatVND(taxResult.taxableIncome)}</span>
              </div>

              <div className="flex justify-between py-1.5 text-amber-300 border-b border-[#243e7c] bg-[#12224d] px-2.5 py-1 rounded-xl">
                <span className="font-semibold">Thuế TNCN (5 bậc 2026):</span>
                <span className="text-rose-300 font-bold">
                  -{formatVND(taxResult.personalIncomeTax)}
                </span>
              </div>

              {/* Net Take-home box */}
              <div className="p-4 bg-gradient-to-r from-[#1c3674] to-[#254694] rounded-2xl border-2 border-amber-300/80 mt-2 shadow-inner">
                <div className="text-[11px] text-amber-300 uppercase tracking-wider font-sans font-bold flex items-center justify-between">
                  <span>TIỀN VỀ VÍ CỦA BẠN (NET TAKE-HOME):</span>
                  <span>💵✨</span>
                </div>
                <div className="text-2xl sm:text-3xl font-bold text-white mt-1">
                  {formatVND(taxResult.netTakeHome)}
                </div>
                <div className="text-[10px] text-sky-200 mt-1 flex justify-between">
                  <span>Thuế thực tế: {taxResult.effectiveTaxRate}%</span>
                  <span>Tổng khấu trừ: {taxResult.effectiveDeductionsRate}%</span>
                </div>
              </div>
            </div>

            {/* Expenses and Savings Output */}
            <div className="pt-2 border-t border-[#243e7c] space-y-2.5 text-xs font-mono">
              <div className="flex justify-between py-1 text-slate-200 border-b border-[#243e7c]">
                <span>Tổng chi tiêu tháng:</span>
                <span className="font-bold text-slate-100">
                  -{formatVND(cashflowResult.totalExpenses)}
                </span>
              </div>

              <div className="flex justify-between py-1 text-slate-300 border-b border-[#243e7c]">
                <span>Chi cố định bắt buộc:</span>
                <span className={cashflowResult.fixedCostRatio > 65 ? 'text-rose-300 font-bold' : 'text-slate-100'}>
                  {formatVND(cashflowResult.fixedExpenses)} ({cashflowResult.fixedCostRatio}% lương)
                </span>
              </div>

              {/* Monthly Savings Result */}
              <div className="p-3.5 bg-[#12224d] border border-[#2b4c96] rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5 font-sans">
                    <PiggyBank className="w-4 h-4 text-emerald-300" />
                    TIỀN BỎ ỐNG HEO THÁNG NÀY:
                  </span>
                  <span className={`text-lg font-bold ${cashflowResult.monthlySavings >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {cashflowResult.monthlySavings >= 0 ? '+' : ''}{formatVND(cashflowResult.monthlySavings)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-300 mt-2 pt-2 border-t border-[#243e7c]">
                  <span>Tỷ lệ tiết kiệm đạt:</span>
                  <span className={`font-bold ${cashflowResult.savingsRate >= 20 ? 'text-emerald-300' : 'text-amber-300'}`}>
                    {cashflowResult.savingsRate}% {cashflowResult.savingsRate >= 20 ? '🎉 (Đạt chuẩn &ge;20%)' : '(Chưa đạt 20%)'}
                  </span>
                </div>
              </div>

              {/* Friendly message from Bé Orca */}
              <div className="p-3 bg-[#0f1d44] border border-[#233f80] rounded-xl text-xs text-slate-200">
                <div className="flex items-center gap-1.5 font-bold text-amber-300 mb-1">
                  <span>🐳 Bé Orca mách nhỏ:</span>
                </div>
                <p className="text-slate-200 leading-relaxed font-sans text-[11px]">
                  {cashflowResult.fixedCostRatio <= 65
                    ? 'Dòng tiền của cậu rất khỏe mạnh luôn nha! Cậu nhớ trích tiền bỏ heo đất trước khi mua sắm nhen!'
                    : `Chi tiêu cố định đang chiếm ${cashflowResult.fixedCostRatio}% thu nhập. Cậu thử rà soát lại tiền thuê nhà hoặc các gói mạng xem tối ưu được xíu nào không nha~`}
                </p>
              </div>
            </div>

            {/* Direct Action Button to Apply */}
            <button
              onClick={handleApply}
              className="w-full py-3 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-lg hover:scale-[1.01] flex items-center justify-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span>CẬP NHẬT KẾT QUẢ VÀO SỔ CỦA BẠN 🐳✨</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
