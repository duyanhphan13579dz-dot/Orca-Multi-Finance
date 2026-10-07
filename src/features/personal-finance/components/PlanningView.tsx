import React, { useState } from 'react';
import {
  MonthlySnapshot,
  AssumptionSet,
  FinancialGoal,
} from '../types/finance.ts';
import { compareDebtStrategies } from '../engines/debtEngine.ts';
import { evaluateGoals } from '../engines/goalsEngine.ts';
import { runFinancialProjection, DEFAULT_ASSUMPTIONS } from '../engines/projectionEngine.ts';
import {
  Target,
  Zap,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Sliders,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface PlanningViewProps {
  currentSnapshot: MonthlySnapshot;
  assumptions: AssumptionSet;
}

export const PlanningView: React.FC<PlanningViewProps> = ({
  currentSnapshot,
  assumptions,
}) => {
  const [activeTab, setActiveTab] = useState<'goals' | 'debt' | 'projection'>('goals');
  const [extraDebtPayment, setExtraDebtPayment] = useState<number>(2000000); // 2 triệu/tháng mặc định
  const [simYears, setSimYears] = useState<number>(25);

  const { goals, debts, metrics, profile } = currentSnapshot;

  // Goals engine
  const evaluatedGoals = evaluateGoals(goals, currentSnapshot.period, metrics.monthlySavings);

  // Debt comparison engine
  const debtComparison = compareDebtStrategies(debts, extraDebtPayment);

  // Projection & Monte Carlo engine
  const projectionRes = runFinancialProjection(
    metrics.netWorth,
    Math.max(1000000, metrics.monthlySavings),
    profile.birthYear,
    assumptions,
    simYears,
    1000
  );

  return (
    <div className="space-y-6">
      {/* Sub tabs */}
      <div className="flex items-center gap-2 border-b border-[#1b2f54] pb-2 text-xs font-mono">
        <button
          onClick={() => setActiveTab('goals')}
          className={`px-3 py-1.5 border transition-colors cursor-pointer ${
            activeTab === 'goals'
              ? 'bg-[#122344] border-amber-500 text-amber-300 font-bold'
              : 'bg-[#080f1d] border-[#162744] text-slate-400 hover:text-white'
          }`}
        >
          1. MỤC TIÊU TÀI CHÍNH ({goals.length})
        </button>
        <button
          onClick={() => setActiveTab('debt')}
          className={`px-3 py-1.5 border transition-colors cursor-pointer ${
            activeTab === 'debt'
              ? 'bg-[#122344] border-amber-500 text-amber-300 font-bold'
              : 'bg-[#080f1d] border-[#162744] text-slate-400 hover:text-white'
          }`}
        >
          2. CHIẾN LƯỢC TRẢ NỢ (AVALANCHE VS SNOWBALL)
        </button>
        <button
          onClick={() => setActiveTab('projection')}
          className={`px-3 py-1.5 border transition-colors cursor-pointer ${
            activeTab === 'projection'
              ? 'bg-[#122344] border-amber-500 text-amber-300 font-bold'
              : 'bg-[#080f1d] border-[#162744] text-slate-400 hover:text-white'
          }`}
        >
          3. DỰ PHÓNG MONTE CARLO & HƯU TRÍ
        </button>
      </div>

      {/* =========================================================
          TAB 1: MỤC TIÊU TÀI CHÍNH
          ========================================================= */}
      {activeTab === 'goals' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Tổng số tiền cần đạt:</span>
              <span className="text-base font-bold text-white mt-1 block">
                {evaluatedGoals.totalTargetAmount.toLocaleString('vi-VN')} ₫
              </span>
            </div>
            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Đã tích lũy được:</span>
              <span className="text-base font-bold text-emerald-400 mt-1 block">
                {evaluatedGoals.totalAccumulatedAmount.toLocaleString('vi-VN')} ₫ ({evaluatedGoals.overallProgressPercent}%)
              </span>
            </div>
            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Số tiền cần góp hàng tháng:</span>
              <span className="text-base font-bold text-amber-300 mt-1 block">
                {evaluatedGoals.totalRequiredMonthlySavings.toLocaleString('vi-VN')} ₫/tháng
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {evaluatedGoals.goals.map((goal) => {
              const progressPct = goal.targetAmount > 0
                ? Number(((goal.accumulatedAmount / goal.targetAmount) * 100).toFixed(1))
                : 100;

              return (
                <div
                  key={goal.id}
                  className="bg-[#091120] border border-[#182b4c] p-4 flex flex-col justify-between"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <Target className="w-4 h-4 text-amber-400" />
                      <h4 className="text-sm font-semibold text-slate-100">{goal.name}</h4>
                      {goal.isLagging && (
                        <span className="bg-rose-950 border border-rose-700 text-rose-300 text-[10px] font-mono px-2 py-0.5 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-400" />
                          CHẬM TIẾN ĐỘ ({goal.lagPercent}%)
                        </span>
                      )}
                      {goal.status === 'completed' && (
                        <span className="bg-emerald-950 border border-emerald-700 text-emerald-300 text-[10px] font-mono px-2 py-0.5">
                          ✓ ĐÃ HOÀN THÀNH
                        </span>
                      )}
                    </div>

                    <div className="text-xs font-mono text-slate-400">
                      Hạn: <strong className="text-slate-200">{goal.deadline}</strong> (còn{' '}
                      {goal.monthsRemaining} tháng)
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="space-y-1 my-2">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-400">
                        {goal.accumulatedAmount.toLocaleString('vi-VN')} ₫ /{' '}
                        {goal.targetAmount.toLocaleString('vi-VN')} ₫
                      </span>
                      <span className="font-bold text-amber-300">{progressPct}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#121f38] overflow-hidden">
                      <div
                        className={`h-full ${goal.isLagging ? 'bg-rose-500' : 'bg-emerald-500'}`}
                        style={{ width: `${Math.min(100, progressPct)}%` }}
                      ></div>
                    </div>
                  </div>

                  <div className="mt-2 pt-2 border-t border-[#13223f] flex flex-wrap items-center justify-between text-xs text-slate-400 font-mono">
                    <div>
                      Cần trích góp:{' '}
                      <strong className="text-white">
                        {goal.requiredMonthlySavings.toLocaleString('vi-VN')} ₫/tháng
                      </strong>
                    </div>
                    <div className="text-[11px] text-slate-500">{goal.feasibilityNotes}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* =========================================================
          TAB 2: CHIẾN LƯỢC TRẢ NỢ (AVALANCHE VS SNOWBALL)
          ========================================================= */}
      {activeTab === 'debt' && (
        <div className="space-y-6">
          {!debtComparison.hasDebt ? (
            <div className="p-8 text-center bg-[#091120] border border-[#182b4c] text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-2" />
              <h4 className="text-sm font-semibold text-emerald-300 mb-1">
                Tài khoản hoàn toàn không có nợ vay
              </h4>
              <p className="text-slate-400">
                Bạn không phải chi trả lãi vay hàng tháng. Hãy dồn toàn bộ nguồn lực để tích lũy tài sản sinh lời.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Extra payment simulator controller */}
              <div className="bg-[#0a1222] border border-[#182b4c] p-4 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-amber-400" />
                    MÔ PHỎNG SỐ TIỀN TRẢ THÊM MỖI THÁNG (EXTRA PAYMENT)
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Tăng số tiền trả thêm để rút ngắn thời gian chịu lãi và giảm tổng lãi phải trả
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="10000000"
                    step="500000"
                    value={extraDebtPayment}
                    onChange={(e) => setExtraDebtPayment(Number(e.target.value))}
                    className="w-48 accent-amber-500 cursor-pointer"
                  />
                  <span className="font-mono text-sm font-bold text-amber-300 bg-[#060b14] px-3 py-1 border border-[#1e335b]">
                    +{extraDebtPayment.toLocaleString('vi-VN')} ₫/tháng
                  </span>
                </div>
              </div>

              {/* Side-by-side Strategy Comparison Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Avalanche Method */}
                <div className="bg-[#091120] border-2 border-emerald-600/80 p-5 relative">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#14233e]">
                    <div>
                      <span className="bg-emerald-950 text-emerald-300 border border-emerald-700 text-[10px] font-mono px-2 py-0.5 uppercase font-bold">
                        KHUYẾN NGHỊ TỐI ƯU TOÁN HỌC
                      </span>
                      <h4 className="text-sm font-bold text-white mt-1">
                        Chiến lược Avalanche (Lãi cao nhất trước)
                      </h4>
                    </div>
                    <Zap className="w-5 h-5 text-emerald-400" />
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed mb-4">
                    {debtComparison.avalanche.description}
                  </p>

                  <div className="space-y-3 font-mono text-xs">
                    <div className="p-2.5 bg-[#070e1c] border border-[#162646] flex justify-between">
                      <span className="text-slate-400">Thời gian sạch nợ:</span>
                      <span className="font-bold text-white">
                        {debtComparison.avalanche.debtFreeDateText}
                      </span>
                    </div>

                    <div className="p-2.5 bg-[#070e1c] border border-[#162646] flex justify-between">
                      <span className="text-slate-400">Tổng tiền lãi phải trả:</span>
                      <span className="font-bold text-emerald-400 text-sm">
                        {debtComparison.avalanche.totalInterestPaid.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>

                    <div className="p-2.5 bg-[#070e1c] border border-[#162646] flex justify-between">
                      <span className="text-slate-400">Tổng số tiền đã trả:</span>
                      <span className="text-slate-200">
                        {debtComparison.avalanche.totalPaid.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                  </div>
                </div>

                {/* Snowball Method */}
                <div className="bg-[#091120] border border-[#182b4c] p-5">
                  <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#14233e]">
                    <div>
                      <span className="bg-cyan-950 text-cyan-300 border border-cyan-700 text-[10px] font-mono px-2 py-0.5 uppercase font-bold">
                        ĐỘNG LỰC TÂM LÝ
                      </span>
                      <h4 className="text-sm font-bold text-white mt-1">
                        Chiến lược Snowball (Dư nợ nhỏ nhất trước)
                      </h4>
                    </div>
                    <Layers className="w-5 h-5 text-cyan-400" />
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed mb-4">
                    {debtComparison.snowball.description}
                  </p>

                  <div className="space-y-3 font-mono text-xs">
                    <div className="p-2.5 bg-[#070e1c] border border-[#162646] flex justify-between">
                      <span className="text-slate-400">Thời gian sạch nợ:</span>
                      <span className="font-bold text-white">
                        {debtComparison.snowball.debtFreeDateText}
                      </span>
                    </div>

                    <div className="p-2.5 bg-[#070e1c] border border-[#162646] flex justify-between">
                      <span className="text-slate-400">Tổng tiền lãi phải trả:</span>
                      <span className="font-bold text-rose-400 text-sm">
                        {debtComparison.snowball.totalInterestPaid.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>

                    <div className="p-2.5 bg-[#070e1c] border border-[#162646] flex justify-between">
                      <span className="text-slate-400">Tổng số tiền đã trả:</span>
                      <span className="text-slate-200">
                        {debtComparison.snowball.totalPaid.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Differential Comparison Summary Box */}
              <div className="p-4 bg-[#0d182e] border border-amber-600/70 text-xs">
                <div className="font-bold text-amber-300 mb-1 flex items-center gap-1.5 font-mono">
                  <span>KẾT LUẬN CHÊNH LỆCH:</span>
                </div>
                <p className="text-slate-300 leading-relaxed">
                  {debtComparison.recommendation.summaryReason}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =========================================================
          TAB 3: DỰ PHÓNG MONTE CARLO & HƯU TRÍ
          ========================================================= */}
      {activeTab === 'projection' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Simulation Chart & Milestones */}
            <div className="lg:col-span-2 bg-[#091120] border border-[#182b4c] p-4">
              <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-[#14233e] gap-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                    MÔ PHỎNG MONTE CARLO (1.000 LƯỢT CHẠY) & DẢI PHÂN VỊ
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Dải P10 (Kịch bản thị trường xấu), P50 (Kịch bản trung vị), P90 (Kịch bản thuận lợi)
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono text-slate-400">Kỳ hạn:</span>
                  <select
                    value={simYears}
                    onChange={(e) => setSimYears(Number(e.target.value))}
                    className="bg-[#060b14] border border-[#1e335b] px-2 py-1 text-xs font-mono text-amber-300"
                  >
                    <option value={15}>15 năm</option>
                    <option value={20}>20 năm</option>
                    <option value={25}>25 năm</option>
                    <option value={30}>30 năm</option>
                  </select>
                </div>
              </div>

              {/* Milestone table */}
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono border-collapse">
                  <thead>
                    <tr className="bg-[#0d182e] border-b border-[#1c3258] text-slate-400 text-left">
                      <th className="py-2 px-3">MỐC NĂM</th>
                      <th className="py-2 px-3 text-right">TUỔI</th>
                      <th className="py-2 px-3 text-right text-rose-300">P10 (KÉM NHẤT)</th>
                      <th className="py-2 px-3 text-right text-amber-300">P50 (TRUNG VỊ)</th>
                      <th className="py-2 px-3 text-right text-emerald-300">P90 (THUẬN LỢI)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#13223f]">
                    {[1, 3, 5, 10, 15, 20, Math.min(simYears, 30)].map((yr) => {
                      const pt = projectionRes.timeline[yr];
                      if (!pt) return null;
                      return (
                        <tr key={yr} className="hover:bg-[#0d1930] transition-colors">
                          <td className="py-2 px-3 font-semibold text-slate-200">
                            Năm {pt.year} (+{yr} năm)
                          </td>
                          <td className="py-2 px-3 text-right text-slate-400">{pt.age} tuổi</td>
                          <td className="py-2 px-3 text-right text-rose-300">
                            {pt.monteCarlo.p10.toLocaleString('vi-VN')} ₫
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-amber-300">
                            {pt.monteCarlo.p50.toLocaleString('vi-VN')} ₫
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-300">
                            {pt.monteCarlo.p90.toLocaleString('vi-VN')} ₫
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Assumptions Panel (B5/B6 requirement: luôn hiển thị giả định đi kèm) */}
            <div className="bg-[#091120] border border-[#182b4c] p-4 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 pb-2 mb-3 border-b border-[#14233e]">
                  GIẢ ĐỊNH KINH TẾ ĐI KÈM MÔ PHỎNG
                </h3>

                <div className="space-y-2.5 text-xs font-mono">
                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Lạm phát bình quân (CPI):</span>
                    <span className="text-slate-200 font-semibold">{assumptions.inflationRate}%/năm</span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Lợi suất Thận trọng (Tiền gửi):</span>
                    <span className="text-slate-200 font-semibold">{assumptions.returnsConservative}%/năm</span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Lợi suất Cơ sở (Quỹ hỗn hợp):</span>
                    <span className="text-amber-300 font-semibold">{assumptions.returnsBase}%/năm</span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Lợi suất Tăng trưởng (Cổ phiếu):</span>
                    <span className="text-emerald-400 font-semibold">{assumptions.returnsAggressive}%/năm</span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Tuổi nghỉ hưu dự kiến:</span>
                    <span className="text-slate-200 font-semibold">{assumptions.retirementAge} tuổi</span>
                  </div>

                  <div className="flex justify-between py-1 border-b border-[#121f38]">
                    <span className="text-slate-400">Kỳ vọng sống bình quân:</span>
                    <span className="text-slate-200 font-semibold">{assumptions.lifeExpectancy} tuổi</span>
                  </div>
                </div>
              </div>

              {/* Retirement Adequacy Box */}
              <div className="mt-4 p-3 bg-[#0a1426] border border-[#1d325a]">
                <div className="text-[11px] text-amber-300 font-semibold mb-1">
                  ĐÁNH GIÁ ĐỘ ĐẦY ĐỦ QUỸ HƯU TRÍ (TUỔI {assumptions.retirementAge}):
                </div>
                <div className="text-base font-bold text-white font-mono">
                  {projectionRes.retirement.projectedNestEggAtRetirement.toLocaleString('vi-VN')} ₫
                </div>
                <div className="text-[11px] text-slate-400 mt-1 font-mono">
                  Dòng thu nhập rút an toàn: ~
                  {projectionRes.retirement.estimatedMonthlyRetirementIncome.toLocaleString('vi-VN')} ₫/tháng
                </div>
                <div className="mt-2 text-[10px] text-emerald-400 font-semibold">
                  {projectionRes.retirement.isSufficient
                    ? '✓ Quỹ hưu trí dự phóng đáp ứng đủ nhu cầu sinh hoạt cơ bản.'
                    : 'Cần nâng tỷ lệ tích lũy đầu tư để bù đắp lạm phát dài hạn.'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
