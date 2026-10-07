import React, { useState } from 'react';
import { MonthlySnapshot } from '../types/finance.ts';
import { calculateCashflow } from '../engines/cashflowEngine.ts';
import { calculateNetworth } from '../engines/networthEngine.ts';
import {
  TrendingUp,
  PieChart,
  ArrowRight,
  Layers,
  Shield,
  CreditCard,
  Building,
} from 'lucide-react';

interface AnalyticsViewProps {
  currentSnapshot: MonthlySnapshot;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ currentSnapshot }) => {
  const [activeTab, setActiveTab] = useState<'cashflow' | 'expenses' | 'networth'>('cashflow');

  const { metrics, income, expenses, assets, debts } = currentSnapshot;
  const cashflowRes = calculateCashflow(
    metrics.totalNetIncome,
    expenses,
    metrics.liquidAssets,
    currentSnapshot.period
  );
  const networthRes = calculateNetworth(assets, debts);

  return (
    <div className="space-y-6">
      {/* Sub tabs */}
      <div className="flex items-center gap-2 border-b border-[#1b2f54] pb-2 text-xs font-mono">
        <button
          onClick={() => setActiveTab('cashflow')}
          className={`px-3 py-1.5 border transition-colors cursor-pointer ${
            activeTab === 'cashflow'
              ? 'bg-[#122344] border-amber-500 text-amber-300 font-bold'
              : 'bg-[#080f1d] border-[#162744] text-slate-400 hover:text-white'
          }`}
        >
          1. DÒNG TIỀN & DỰ BÁO 12 THÁNG
        </button>
        <button
          onClick={() => setActiveTab('expenses')}
          className={`px-3 py-1.5 border transition-colors cursor-pointer ${
            activeTab === 'expenses'
              ? 'bg-[#122344] border-amber-500 text-amber-300 font-bold'
              : 'bg-[#080f1d] border-[#162744] text-slate-400 hover:text-white'
          }`}
        >
          2. CƠ CẤU CHI TIÊU (CỐ ĐỊNH VS BIẾN ĐỔI)
        </button>
        <button
          onClick={() => setActiveTab('networth')}
          className={`px-3 py-1.5 border transition-colors cursor-pointer ${
            activeTab === 'networth'
              ? 'bg-[#122344] border-amber-500 text-amber-300 font-bold'
              : 'bg-[#080f1d] border-[#162744] text-slate-400 hover:text-white'
          }`}
        >
          3. TÀI SẢN RÒNG & PHÂN LỚP TÀI SẢN
        </button>
      </div>

      {/* =========================================================
          TAB 1: DÒNG TIỀN & DỰ BÁO 12 THÁNG
          ========================================================= */}
      {activeTab === 'cashflow' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 font-mono text-xs">
            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Thu nhập thực nhận:</span>
              <span className="text-base font-bold text-white mt-1 block">
                {metrics.totalNetIncome.toLocaleString('vi-VN')} ₫
              </span>
              <span className="text-[10px] text-slate-500">Sau thuế TNCN & BHXH 2026</span>
            </div>

            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Tổng chi tiêu:</span>
              <span className="text-base font-bold text-slate-200 mt-1 block">
                {metrics.totalExpenses.toLocaleString('vi-VN')} ₫
              </span>
              <span className="text-[10px] text-slate-500">
                Chi cố định: {metrics.fixedCostRatio}% (Trần 65%)
              </span>
            </div>

            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Tiết kiệm tháng này:</span>
              <span className="text-base font-bold text-emerald-400 mt-1 block">
                {metrics.monthlySavings.toLocaleString('vi-VN')} ₫
              </span>
              <span className="text-[10px] text-emerald-400">
                Tỷ lệ tiết kiệm: {metrics.savingsRate}%
              </span>
            </div>

            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Chi tiêu trung bình ngày:</span>
              <span className="text-base font-bold text-amber-300 mt-1 block">
                {cashflowRes.burnRatePerDay.toLocaleString('vi-VN')} ₫/ngày
              </span>
              <span className="text-[10px] text-slate-500">30 ngày sinh hoạt chuẩn</span>
            </div>
          </div>

          {/* 12-Month Forward Projection Table */}
          <div className="bg-[#091120] border border-[#182b4c] p-4">
            <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#14233e]">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
                  DỰ BÁO DÒNG TIỀN VÀ THẶNG DƯ TÍCH LŨY 12 THÁNG TỚI
                </h3>
                <p className="text-[11px] text-slate-400">
                  Mô hình hóa thu nhập thực nhận, chi tiêu sinh hoạt và thặng dư luỹ kế
                </p>
              </div>
              <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 border border-emerald-700/60">
                ENGINE CASHFLOW 12M
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="bg-[#0d182e] border-b border-[#1c3258] text-slate-400 text-left">
                    <th className="py-2 px-3">KỲ DỰ BÁO</th>
                    <th className="py-2 px-3 text-right">THU NHẬP DỰ KIẾN</th>
                    <th className="py-2 px-3 text-right">CHI TIÊU DỰ KIẾN</th>
                    <th className="py-2 px-3 text-right">TIẾT KIỆM THÁNG</th>
                    <th className="py-2 px-3 text-right">THẶNG DƯ LUỸ KẾ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#13223f]">
                  {cashflowRes.forecast12Months.map((row) => (
                    <tr key={row.monthIndex} className="hover:bg-[#0d1930] transition-colors">
                      <td className="py-2 px-3 font-semibold text-slate-200">{row.monthLabel}</td>
                      <td className="py-2 px-3 text-right text-slate-300">
                        {row.projectedIncome.toLocaleString('vi-VN')} ₫
                      </td>
                      <td className="py-2 px-3 text-right text-slate-300">
                        {row.projectedExpense.toLocaleString('vi-VN')} ₫
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-emerald-400">
                        +{row.projectedSavings.toLocaleString('vi-VN')} ₫
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-amber-300">
                        {row.cumulativeSavings.toLocaleString('vi-VN')} ₫
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          TAB 2: CƠ CẤU CHI TIÊU
          ========================================================= */}
      {activeTab === 'expenses' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Expense breakdown table */}
            <div className="bg-[#091120] border border-[#182b4c] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 pb-2 mb-3 border-b border-[#14233e]">
                CHI TIẾT 11 NHÓM CHI TIÊU KỲ {currentSnapshot.period}
              </h3>

              <div className="space-y-2 text-xs">
                {expenses.map((exp) => {
                  const pctOfTotal = metrics.totalExpenses > 0
                    ? ((exp.amount / metrics.totalExpenses) * 100).toFixed(1)
                    : '0';
                  const pctOfIncome = metrics.totalNetIncome > 0
                    ? ((exp.amount / metrics.totalNetIncome) * 100).toFixed(1)
                    : '0';

                  return (
                    <div
                      key={exp.id}
                      className="p-2.5 bg-[#0a1222] border border-[#14233e] flex items-center justify-between"
                    >
                      <div>
                        <div className="font-semibold text-slate-200 flex items-center gap-2">
                          <span>{exp.name}</span>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.2 border ${
                              exp.isFixed
                                ? 'border-amber-600/70 text-amber-300 bg-amber-950/40'
                                : 'border-cyan-600/70 text-cyan-300 bg-cyan-950/40'
                            }`}
                          >
                            {exp.isFixed ? 'CỐ ĐỊNH' : 'BIẾN ĐỔI'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {pctOfTotal}% tổng chi · {pctOfIncome}% thu nhập
                        </div>
                      </div>

                      <div className="font-mono font-bold text-white text-sm">
                        {exp.amount.toLocaleString('vi-VN')} ₫
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Strategic Expense Health Assessment */}
            <div className="space-y-4">
              <div className="bg-[#091120] border border-[#182b4c] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 pb-2 mb-3 border-b border-[#14233e]">
                  ĐÁNH GIÁ CHUẨN MỰC PHÂN PHỐI NGÂN SÁCH (50/30/20)
                </h3>

                <div className="space-y-4 text-xs font-mono">
                  {/* Fixed expenses (Needs) */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Nhu cầu thiết yếu cố định (Needs):</span>
                      <span className={`font-bold ${metrics.fixedCostRatio > 65 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {metrics.fixedCostRatio}% / mục tiêu &le; 50-65%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#121f38]">
                      <div
                        className={`h-full ${metrics.fixedCostRatio > 65 ? 'bg-rose-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, metrics.fixedCostRatio)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Variable expenses (Wants) */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Chi tiêu biến đổi linh hoạt (Wants):</span>
                      <span className="font-bold text-cyan-400">
                        {metrics.totalNetIncome > 0
                          ? ((metrics.variableExpenses / metrics.totalNetIncome) * 100).toFixed(1)
                          : 0}
                        % / mục tiêu &le; 30%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#121f38]">
                      <div
                        className="h-full bg-cyan-500"
                        style={{
                          width: `${Math.min(
                            100,
                            metrics.totalNetIncome > 0
                              ? (metrics.variableExpenses / metrics.totalNetIncome) * 100
                              : 0
                          )}%`,
                        }}
                      ></div>
                    </div>
                  </div>

                  {/* Savings & Investments */}
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-slate-300">Tiết kiệm & Đầu tư (Savings):</span>
                      <span className={`font-bold ${metrics.savingsRate >= 20 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {metrics.savingsRate}% / mục tiêu &ge; 20%
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#121f38]">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${Math.min(100, Math.max(0, metrics.savingsRate))}%` }}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Warning note if fixed costs are high */}
              <div className="bg-[#0b1424] border border-[#1b2f54] p-4 text-xs text-slate-300">
                <div className="font-semibold text-amber-300 mb-1">
                  Khuyến nghị quản trị ngân sách:
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Nguyên tắc &quot;Pay Yourself First&quot; (Trả cho mình trước): Trích ngay 20% thu nhập thực nhận vào tài khoản tích lũy sinh lời hoặc quỹ khẩn cấp ngay khi có lương, sau đó điều chỉnh phần còn lại cho các nhóm chi biến đổi.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          TAB 3: TÀI SẢN RÒNG & CƠ CẤU
          ========================================================= */}
      {activeTab === 'networth' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono text-xs">
            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Tổng tài sản:</span>
              <span className="text-lg font-bold text-white mt-1 block">
                {networthRes.totalAssets.toLocaleString('vi-VN')} ₫
              </span>
              <span className="text-[10px] text-slate-500">Gồm 8 phân lớp tài sản</span>
            </div>

            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">Tổng nợ phải trả:</span>
              <span className="text-lg font-bold text-rose-400 mt-1 block">
                {networthRes.totalDebt.toLocaleString('vi-VN')} ₫
              </span>
              <span className="text-[10px] text-slate-500">
                Tỷ lệ nợ/tài sản: {networthRes.debtToAssetRatio}%
              </span>
            </div>

            <div className="bg-[#0a1222] border border-[#182b4c] p-3">
              <span className="text-slate-400 text-[11px] block">TÀI SẢN RÒNG THỰC TẾ:</span>
              <span className="text-lg font-bold text-amber-300 mt-1 block">
                {networthRes.netWorth.toLocaleString('vi-VN')} ₫
              </span>
              <span className="text-[10px] text-emerald-400">
                Bất biến: Net Worth = Assets - Debt
              </span>
            </div>
          </div>

          {/* Asset Allocation Breakdown Table */}
          <div className="bg-[#091120] border border-[#182b4c] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 pb-2 mb-3 border-b border-[#14233e]">
              CƠ CẤU PHÂN BỔ THEO DANH MỤC TÀI SẢN
            </h3>

            <div className="space-y-3">
              {networthRes.assetBreakdown
                .filter((cat) => cat.total > 0)
                .map((cat) => (
                  <div key={cat.category} className="space-y-1">
                    <div className="flex justify-between text-xs font-mono">
                      <span className="text-slate-200 font-semibold">{cat.label}</span>
                      <span className="text-slate-300 font-bold">
                        {cat.total.toLocaleString('vi-VN')} ₫ ({cat.percentage}%)
                      </span>
                    </div>
                    <div className="w-full h-2 bg-[#121f38] overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-amber-600 to-amber-400"
                        style={{ width: `${Math.min(100, cat.percentage)}%` }}
                      ></div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
