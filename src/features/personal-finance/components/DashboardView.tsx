import React, { useState } from 'react';
import {
  MonthlySnapshot,
  CalculatedMetrics,
  Insight,
  ExpenseItem,
} from '../types/finance.ts';
import { OFFICIAL_MARKET_DATA } from '../engines/marketData.ts';
import { QuickCashflowCalculator } from './QuickCashflowCalculator.tsx';
import { OrcaMascot } from './OrcaMascot.tsx';
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  PiggyBank,
  HeartPulse,
  Clock,
  ArrowUpRight,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Calculator,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Heart,
} from 'lucide-react';

interface DashboardViewProps {
  currentSnapshot: MonthlySnapshot;
  allSnapshots: MonthlySnapshot[];
  insights: InsightsProps[];
  onNavigateToCheckin: () => void;
  onNavigateToAdvice: () => void;
  onNavigateToPlanning: () => void;
  onNavigateToAskOrca?: () => void;
  onToggleInsightStatus: (id: string, newStatus: 'new' | 'completed' | 'dismissed') => void;
  onApplyCashflowToSnapshot: (params: {
    grossSalary: number;
    bonus: number;
    otherIncome: number;
    insuranceSalaryBase: number;
    dependentsCount: number;
    expenses: ExpenseItem[];
  }) => void;
}

type InsightsProps = Insight;

export const DashboardView: React.FC<DashboardViewProps> = ({
  currentSnapshot,
  allSnapshots,
  insights,
  onNavigateToCheckin,
  onNavigateToAdvice,
  onNavigateToPlanning,
  onNavigateToAskOrca,
  onToggleInsightStatus,
  onApplyCashflowToSnapshot,
}) => {
  const [showQuickCalc, setShowQuickCalc] = useState<boolean>(true);
  const { metrics } = currentSnapshot;

  // Tìm kỳ tháng trước để tính so sánh delta
  const currentIndex = allSnapshots.findIndex((s) => s.period === currentSnapshot.period);
  const prevSnapshot = currentIndex > 0 ? allSnapshots[currentIndex - 1] : undefined;

  // Tính delta tài sản ròng
  const nwDeltaAmount = prevSnapshot ? metrics.netWorth - prevSnapshot.metrics.netWorth : 0;
  const nwDeltaPercent = prevSnapshot && prevSnapshot.metrics.netWorth !== 0
    ? ((nwDeltaAmount / Math.abs(prevSnapshot.metrics.netWorth)) * 100).toFixed(1)
    : '0.0';

  // Sắp xếp các snapshots theo thời gian để vẽ đồ thị
  const sortedSnapshots = [...allSnapshots].sort((a, b) => a.period.localeCompare(b.period));

  const mascotMood = metrics.healthScore.total >= 80
    ? 'cheering'
    : metrics.savingsRate >= 20
    ? 'happy'
    : metrics.emergencyFundMonths < 3
    ? 'caution'
    : 'saving';

  // Cute conversational greeting from Bé Orca
  const welcomeMessage = metrics.healthScore.total >= 80
    ? `Bé Orca chào cậu nha! Điểm sức khỏe tài chính của cậu đạt tận ${metrics.healthScore.total}/100 lận nè, giỏi quá đi thôi! 🐳👑`
    : metrics.savingsRate >= 20
    ? `Chào cậu nè! Tháng này cậu bỏ heo đất được ${metrics.savingsRate}% lương rồi đó, tuyệt vời ghê! 🐷✨`
    : `Chào cậu! Bé Orca ở đây đồng hành cùng cậu giữ tiền và tính toán chi tiêu nhen! Cần gì cứ bấm bé nha! 💖`;

  return (
    <div className="space-y-6">
      {/* Cute Mascot Greeting Banner (Brighter & Decluttered) */}
      <div className="bg-gradient-to-r from-[#172d63] via-[#1f3c85] to-[#172e66] border border-sky-400/40 p-5 rounded-3xl shadow-xl flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <OrcaMascot mood={mascotMood} size={80} bubbleText={welcomeMessage} />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-amber-300 text-xs font-bold font-mono tracking-wider uppercase">
                KỲ SỔ SÁCH {currentSnapshot.period}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-xs text-sky-200 font-semibold">Bé Orca Finance</span>
            </div>
            <h2 className="text-lg sm:text-xl font-bold text-white mt-0.5">
              Túi tiền của cậu hôm nay thế nào rồi nè?
            </h2>
            <p className="text-xs text-sky-100 mt-1">
              Cậu có thể nhập nhanh thu nhập ở bảng tính bên dưới hoặc bấm Check-in để cập nhật sổ nha! 🐳
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {onNavigateToAskOrca && (
            <button
              onClick={onNavigateToAskOrca}
              className="px-4 py-2 bg-gradient-to-r from-sky-500 via-sky-400 to-blue-500 hover:from-sky-400 hover:to-blue-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer hover:scale-105 flex items-center gap-1.5"
            >
              <span>💬 Hỏi Bé Orca AI</span>
            </button>
          )}

          <button
            onClick={onNavigateToCheckin}
            className="px-4 py-2 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer hover:scale-105"
          >
            📝 Monthly Check-in (~5 ph)
          </button>
        </div>
      </div>

      {/* QUICK CASHFLOW CALCULATOR SECTION (Requested by User) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between bg-[#152756] border border-[#2d4d98] px-4 py-3 rounded-2xl shadow-md">
          <div className="flex items-center gap-2.5">
            <span className="text-lg">⚡</span>
            <div>
              <span className="text-xs font-bold text-white tracking-wide uppercase">
                BẢNG NHẬP & TÍNH TOÁN DÒNG TIỀN CÙNG BÉ ORCA (LIVE CALCULATOR)
              </span>
              <span className="text-xs text-sky-200 ml-2 hidden sm:inline">
                · Gõ lương, thưởng, chi tiêu vào đây để bé Orca tính ngay thu nhập về ví nhé!
              </span>
            </div>
          </div>

          <button
            onClick={() => setShowQuickCalc(!showQuickCalc)}
            className="flex items-center gap-1.5 text-xs font-mono text-amber-300 hover:text-white px-3.5 py-1.5 bg-[#1b326e] hover:bg-[#234292] rounded-xl border border-amber-400/40 transition-all cursor-pointer"
          >
            <span>{showQuickCalc ? 'Thu gọn bảng tính ∧' : 'Mở bảng tính dòng tiền ∨'}</span>
          </button>
        </div>

        {showQuickCalc && (
          <QuickCashflowCalculator
            currentSnapshot={currentSnapshot}
            onApplyCashflowToSnapshot={onApplyCashflowToSnapshot}
          />
        )}
      </div>

      {/* TOP 4 PRIMARY KPIS - Brighter & Cleaner Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* KPI 1: Tài sản ròng */}
        <div className="bg-[#142552] border border-[#2b4b96] p-4.5 rounded-2xl shadow-md relative hover:border-amber-400/60 transition-all">
          <div className="flex items-center justify-between text-xs text-slate-200 mb-1">
            <span className="font-bold text-[11px] uppercase tracking-wider text-sky-300 flex items-center gap-1">
              <span>💎</span>
              <span>1. TÀI SẢN RÒNG</span>
            </span>
            <Wallet className="w-4 h-4 text-amber-300" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tracking-tight my-1">
            {metrics.netWorth.toLocaleString('vi-VN')} <span className="text-sm font-normal text-slate-300">₫</span>
          </div>
          <div className="flex items-center gap-2 text-xs pt-2 border-t border-[#233f82] mt-2">
            {prevSnapshot ? (
              <div className={`flex items-center gap-1 font-mono font-medium ${nwDeltaAmount >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {nwDeltaAmount >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span>
                  {nwDeltaAmount >= 0 ? '+' : ''}{nwDeltaAmount.toLocaleString('vi-VN')} ₫ ({nwDeltaAmount >= 0 ? '+' : ''}{nwDeltaPercent}%)
                </span>
              </div>
            ) : (
              <span className="text-slate-300 font-mono text-[11px]">Kỳ đầu tiên ghi nhận</span>
            )}
            <span className="text-slate-400 text-[10px]">so với tháng trước</span>
          </div>
        </div>

        {/* KPI 2: Tiết kiệm tháng này */}
        <div className="bg-[#142552] border border-[#2b4b96] p-4.5 rounded-2xl shadow-md relative hover:border-emerald-400/60 transition-all">
          <div className="flex items-center justify-between text-xs text-slate-200 mb-1">
            <span className="font-bold text-[11px] uppercase tracking-wider text-emerald-300 flex items-center gap-1">
              <span>🐷</span>
              <span>2. TIẾT KIỆM THÁNG NÀY</span>
            </span>
            <PiggyBank className="w-4 h-4 text-emerald-300" />
          </div>
          <div className="font-mono text-2xl font-bold text-white tracking-tight my-1">
            {metrics.monthlySavings.toLocaleString('vi-VN')} <span className="text-sm font-normal text-slate-300">₫</span>
          </div>
          <div className="flex items-center justify-between text-xs pt-2 border-t border-[#233f82] mt-2 font-mono">
            <span className={`font-bold ${metrics.savingsRate >= 20 ? 'text-emerald-300' : 'text-amber-300'}`}>
              Đạt: {metrics.savingsRate}% lương
            </span>
            <span className="text-slate-300 text-[11px]">Mục tiêu: &ge; 20%</span>
          </div>
        </div>

        {/* KPI 3: Điểm sức khỏe tài chính */}
        <div className="bg-[#142552] border border-[#2b4b96] p-4.5 rounded-2xl shadow-md relative hover:border-amber-400/60 transition-all">
          <div className="flex items-center justify-between text-xs text-slate-200 mb-1">
            <span className="font-bold text-[11px] uppercase tracking-wider text-amber-300 flex items-center gap-1">
              <span>🌟</span>
              <span>3. ĐIỂM SỨC KHỎE</span>
            </span>
            <HeartPulse className="w-4 h-4 text-rose-300" />
          </div>
          <div className="flex items-baseline gap-2 my-1">
            <span className="font-mono text-2xl font-bold text-white">
              {metrics.healthScore.total}
            </span>
            <span className="font-mono text-xs text-slate-300">/ 100</span>
            <span
              className="text-xs font-bold px-2.5 py-0.5 ml-auto rounded-full border"
              style={{
                borderColor: metrics.healthScore.ratingText === 'Xuất sắc' ? '#34d399' : '#fbbf24',
                color: metrics.healthScore.ratingText === 'Xuất sắc' ? '#34d399' : '#fbbf24',
                backgroundColor: 'rgba(20, 37, 82, 0.95)',
              }}
            >
              {metrics.healthScore.ratingText}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs pt-2 border-t border-[#233f82] mt-2 font-mono text-[11px]">
            <span className="text-slate-300">
              5 nhóm: Dòng tiền, Quỹ dự phòng, Nợ, Tích lũy & Kỷ luật
            </span>
          </div>
        </div>

        {/* KPI 4: Quỹ khẩn cấp */}
        <div className="bg-[#142552] border border-[#2b4b96] p-4.5 rounded-2xl shadow-md relative hover:border-sky-400/60 transition-all">
          <div className="flex items-center justify-between text-xs text-slate-200 mb-1">
            <span className="font-bold text-[11px] uppercase tracking-wider text-sky-300 flex items-center gap-1">
              <span>🛡️</span>
              <span>4. QUỸ DỰ PHÒNG</span>
            </span>
            <Clock className="w-4 h-4 text-sky-300" />
          </div>
          <div className="flex items-baseline gap-2 my-1">
            <span className="font-mono text-2xl font-bold text-white">
              {metrics.emergencyFundMonths}
            </span>
            <span className="text-sm font-normal text-slate-300">tháng</span>
            <span className="text-xs font-mono text-slate-300 ml-auto">
              ({metrics.liquidAssets.toLocaleString('vi-VN')} ₫)
            </span>
          </div>
          <div className="flex items-center justify-between text-xs pt-2 border-t border-[#233f82] mt-2 font-mono">
            <span className={metrics.emergencyFundMonths >= 3.0 ? 'text-emerald-300 font-medium' : 'text-rose-300 font-medium'}>
              {metrics.emergencyFundMonths >= 3.0 ? '✓ Đạt chuẩn an toàn' : '⚠️ Cần thêm dự phòng'}
            </span>
            <span className="text-slate-300 text-[11px]">Chuẩn: 3 - 6 tháng</span>
          </div>
        </div>
      </div>

      {/* CUTE AI CALLOUT BANNER - Bé Orca AI phân bổ tài chính cuộc sống */}
      {onNavigateToAskOrca && (
        <div className="bg-gradient-to-r from-[#17306b] via-[#1f3e87] to-[#16316e] border border-sky-400/40 p-5 rounded-3xl shadow-xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <OrcaMascot mood="waving" size={72} showBadgeBackground />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-amber-300 bg-amber-400/20 px-2 py-0.5 rounded-full border border-amber-400/30 uppercase tracking-wide font-mono">
                  ✨ TÍNH NĂNG MỚI: BÉ ORCA AI
                </span>
                <span className="text-xs text-sky-200">· Trợ lý tài chính cuộc sống</span>
              </div>
              <h3 className="text-sm sm:text-base font-bold text-white mt-0.5">
                Cậu cần tư vấn phân bổ tiền lương, thưởng hay mục tiêu mua sắm?
              </h3>
              <p className="text-xs text-sky-100 mt-0.5">
                Bé Orca dùng Gemini AI tính toán con số thực tế theo hoàn cảnh sống tại Việt Nam nè! 🐳
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onNavigateToAskOrca}
              className="px-4 py-2 bg-gradient-to-r from-sky-400 to-blue-500 hover:from-sky-300 hover:to-blue-400 text-slate-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer hover:scale-105 flex items-center gap-1.5"
            >
              <span>💬 Trò chuyện cùng Bé Orca</span>
              <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* CHARTS GRID - Brighter & Clean */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart 1: Lịch sử tài sản ròng theo thời gian */}
        <div className="lg:col-span-2 bg-[#142552] border border-[#2b4b96] p-5 rounded-2xl shadow-md">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#233f82]">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
                <span>📈</span>
                <span>BIẾN ĐỘNG TÀI SẢN RÒNG VÀ NỢ VAY QUA CÁC KỲ</span>
              </h3>
              <p className="text-[11px] text-sky-200">
                Tài sản ròng = Tổng tài sản - Tổng nợ
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-[11px]">
              <span className="flex items-center gap-1.5 text-amber-300">
                <span className="w-3 h-1 bg-amber-400 inline-block rounded-full"></span>
                Tài sản ròng
              </span>
              <span className="flex items-center gap-1.5 text-rose-300">
                <span className="w-3 h-1 bg-rose-400 inline-block rounded-full"></span>
                Nợ vay
              </span>
            </div>
          </div>

          {/* SVG Line / Bar Chart */}
          <div className="h-56 w-full flex flex-col justify-end">
            {sortedSnapshots.length > 0 ? (
              <div className="h-full w-full flex items-end gap-6 pt-4 pb-2">
                {sortedSnapshots.map((s) => {
                  const maxVal = Math.max(
                    ...sortedSnapshots.map((x) => Math.max(x.metrics.totalAssets, 1000000))
                  );
                  const netHeight = Math.max(8, Math.min(100, (s.metrics.netWorth / maxVal) * 100));
                  const debtHeight = Math.max(2, Math.min(100, (s.metrics.totalDebt / maxVal) * 100));
                  const isCurrent = s.period === currentSnapshot.period;

                  return (
                    <div key={s.period} className="flex-1 flex flex-col items-center h-full justify-end group">
                      <div className="text-[10px] font-mono text-amber-300 opacity-0 group-hover:opacity-100 transition-opacity mb-1 whitespace-nowrap">
                        {Math.round(s.metrics.netWorth / 1000000)}M ₫
                      </div>
                      
                      <div className="w-full max-w-[48px] flex items-end justify-center gap-1.5 h-36 border-b border-[#3053a4]">
                        {/* Net worth bar */}
                        <div
                          style={{ height: `${netHeight}%` }}
                          className={`w-6 rounded-t-xl transition-all ${
                            isCurrent
                              ? 'bg-gradient-to-t from-amber-400 to-amber-300 shadow-md'
                              : 'bg-[#2b4c96] group-hover:bg-[#3861bd]'
                          }`}
                          title={`Tài sản ròng kỳ ${s.period}: ${s.metrics.netWorth.toLocaleString('vi-VN')} ₫`}
                        ></div>

                        {/* Debt bar */}
                        {s.metrics.totalDebt > 0 && (
                          <div
                            style={{ height: `${debtHeight}%` }}
                            className="w-3.5 bg-rose-500/80 group-hover:bg-rose-400 rounded-t-lg transition-all"
                            title={`Dư nợ kỳ ${s.period}: ${s.metrics.totalDebt.toLocaleString('vi-VN')} ₫`}
                          ></div>
                        )}
                      </div>

                      <div className={`mt-2 font-mono text-xs ${isCurrent ? 'text-amber-300 font-bold' : 'text-slate-300'}`}>
                        {s.period}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400 text-xs">
                Chưa đủ dữ liệu lịch sử
              </div>
            )}
          </div>
        </div>

        {/* Chart 2: Cơ cấu chi tiêu */}
        <div className="bg-[#142552] border border-[#2b4b96] p-5 rounded-2xl shadow-md flex flex-col justify-between">
          <div>
            <div className="pb-3 mb-3 border-b border-[#233f82]">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
                <span>🍰</span>
                <span>CƠ CẤU CHI TIÊU THÁNG</span>
              </h3>
              <p className="text-[11px] text-sky-200">
                Chi cố định tối đa 65% thu nhập
              </p>
            </div>

            {/* Fixed vs Variable bar */}
            <div className="space-y-3.5 pt-2">
              <div>
                <div className="flex items-center justify-between text-xs font-mono mb-1">
                  <span className="text-slate-200 font-medium">Chi cố định:</span>
                  <span className={`font-bold ${metrics.fixedCostRatio > 65 ? 'text-rose-300' : 'text-slate-100'}`}>
                    {metrics.fixedExpenses.toLocaleString('vi-VN')} ₫ ({metrics.fixedCostRatio}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-[#0f1d44] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${metrics.fixedCostRatio > 65 ? 'bg-rose-400' : 'bg-amber-400'}`}
                    style={{ width: `${Math.min(100, metrics.fixedCostRatio)}%` }}
                  ></div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-mono mb-1">
                  <span className="text-slate-200 font-medium">Chi biến đổi:</span>
                  <span className="text-slate-100 font-bold">
                    {metrics.variableExpenses.toLocaleString('vi-VN')} ₫ (
                    {metrics.totalNetIncome > 0
                      ? ((metrics.variableExpenses / metrics.totalNetIncome) * 100).toFixed(1)
                      : 0}
                    %)
                  </span>
                </div>
                <div className="w-full h-3 bg-[#0f1d44] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-sky-400 rounded-full"
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

              <div>
                <div className="flex items-center justify-between text-xs font-mono mb-1">
                  <span className="text-slate-200 font-medium">Tiết kiệm bỏ heo:</span>
                  <span className="text-emerald-300 font-bold">
                    {metrics.monthlySavings.toLocaleString('vi-VN')} ₫ ({metrics.savingsRate}%)
                  </span>
                </div>
                <div className="w-full h-3 bg-[#0f1d44] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-400 rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, metrics.savingsRate))}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick status box */}
          <div className="mt-4 p-3.5 bg-[#172a5a] border border-[#2d4d98] rounded-xl text-xs">
            <div className="text-slate-100 font-bold mb-1 flex items-center gap-1.5">
              <span>🐳 Bé Orca mách nhỏ:</span>
            </div>
            <p className="text-sky-100 text-[11px] leading-relaxed">
              {metrics.fixedCostRatio <= 65
                ? 'Dòng tiền của cậu đang rất thảnh thơi và an toàn, tiếp tục phát huy nhen!'
                : 'Tháng này chi cố định hơi nhỉnh hơn 65% một xíu. Cùng bé Orca kiểm tra lại nha!'}
            </p>
          </div>
        </div>
      </div>

      {/* TOP ACTIONABLE INSIGHTS */}
      <div className="bg-[#142552] border border-[#2b4b96] p-5 rounded-2xl shadow-md">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#233f82]">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100 flex items-center gap-2">
              <span className="w-2.5 h-2.5 bg-amber-400 rounded-full"></span>
              LỜI KHUYÊN ƯU TIÊN TỪ BÉ ORCA (6 PHẦN ĐỊNH LƯỢNG)
            </h3>
            <p className="text-[11px] text-sky-200">
              Có con số và thời hạn rõ ràng để cậu dễ dàng làm theo nhen!
            </p>
          </div>

          <button
            onClick={onNavigateToAdvice}
            className="text-xs font-mono text-amber-300 hover:text-white flex items-center gap-1 cursor-pointer font-bold"
          >
            <span>Xem tất cả lời khuyên</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {insights.length === 0 ? (
          <div className="p-6 text-center text-slate-300 text-xs">
            Chưa có khuyến nghị mới cho kỳ này.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {insights.slice(0, 2).map((ins) => (
              <div
                key={ins.id}
                className="bg-[#172a5a] border border-[#2d4d98] p-4.5 rounded-2xl flex flex-col justify-between shadow-sm"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <span
                      className={`text-[10px] font-mono px-2.5 py-0.5 uppercase font-bold rounded-full border ${
                        ins.severity === 'critical'
                          ? 'border-rose-400 text-rose-200 bg-rose-950/70'
                          : ins.severity === 'warning'
                          ? 'border-amber-400 text-amber-200 bg-amber-950/70'
                          : 'border-emerald-400 text-emerald-200 bg-emerald-950/70'
                      }`}
                    >
                      {ins.severity === 'critical' ? '⚡ ƯU TIÊN SỐ 1' : '⚠️ LƯU Ý'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-300">MÃ: {ins.ruleCode}</span>
                  </div>

                  <h4 className="text-sm font-bold text-white mb-2">{ins.title}</h4>

                  <div className="space-y-1.5 text-xs text-slate-200">
                    <p>
                      <strong className="text-slate-300 font-semibold">1. Phát hiện:</strong>{' '}
                      {ins.content.finding}
                    </p>
                    <p>
                      <strong className="text-slate-300 font-semibold">2. Tác động:</strong>{' '}
                      {ins.content.impact}
                    </p>
                    <p>
                      <strong className="text-amber-300 font-bold">3. Hành động:</strong>{' '}
                      <span className="text-white font-medium">{ins.content.action}</span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-[#233f82] flex items-center justify-between text-xs">
                  <div className="font-mono">
                    <span className="text-slate-300 text-[10px]">Số tiền đề xuất: </span>
                    <span className="text-amber-300 font-bold">
                      {ins.content.amount.toLocaleString('vi-VN')} ₫
                    </span>
                  </div>

                  <button
                    onClick={() =>
                      onToggleInsightStatus(
                        ins.id,
                        ins.status === 'completed' ? 'new' : 'completed'
                      )
                    }
                    className={`px-3.5 py-1.5 text-[11px] font-mono cursor-pointer rounded-xl border transition-all ${
                      ins.status === 'completed'
                        ? 'bg-emerald-900/90 text-emerald-200 border-emerald-400 font-bold'
                        : 'bg-[#1b326e] text-slate-200 hover:text-white border-[#335bb5]'
                    }`}
                  >
                    {ins.status === 'completed' ? '✓ Đã hoàn thành' : 'Đánh dấu đã làm'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Official Market Reference Ticker Bar at Bottom (Simplified & Clean) */}
      <div className="bg-[#142552] border border-[#2b4b96] p-4.5 rounded-2xl text-xs">
        <div className="flex items-center justify-between mb-2.5 pb-2 border-b border-[#233f82]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span className="font-bold text-slate-100 uppercase tracking-wider text-[11px]">
              DỮ LIỆU THỊ TRƯỜNG THỰC TẾ (SBV, VIETCOMBANK, SJC)
            </span>
          </div>
          <span className="text-[11px] font-mono text-sky-200">
            Cập nhật: 05/10/2026 ICT
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {OFFICIAL_MARKET_DATA.slice(0, 4).map((item) => (
            <div key={item.id} className="bg-[#0f1d44] border border-[#264388] p-3 rounded-xl">
              <div className="text-[10px] text-slate-300 truncate mb-1">{item.indicator}</div>
              <div className="flex items-baseline justify-between">
                <span className="font-mono text-sm font-bold text-amber-300">
                  {item.value} <span className="text-[10px] font-normal text-slate-300">{item.unit}</span>
                </span>
                <span className="text-[10px] font-mono text-sky-300">{item.changeText}</span>
              </div>
              <div className="text-[9px] text-slate-400 mt-1 truncate">
                {item.sourceName}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
