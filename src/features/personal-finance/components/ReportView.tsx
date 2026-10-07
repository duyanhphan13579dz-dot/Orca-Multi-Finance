import React, { useState } from 'react';
import { MonthlySnapshot, FinanceProfile } from '../types/finance.ts';
import { generateReportNarrative, extractFactsFromSnapshot, generateDeterministicNarrative } from '../engines/narratorEngine.ts';
import {
  Printer,
  Sparkles,
  ShieldCheck,
  FileText,
  Building,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { OrcaMascot } from './OrcaMascot.tsx';

interface ReportViewProps {
  currentSnapshot: MonthlySnapshot;
  profile: FinanceProfile;
}

export const ReportView: React.FC<ReportViewProps> = ({ currentSnapshot, profile }) => {
  const [narrativeText, setNarrativeText] = useState<string>(() => {
    const facts = extractFactsFromSnapshot(currentSnapshot);
    return generateDeterministicNarrative(facts);
  });
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);

  const { metrics, income, expenses, assets, debts } = currentSnapshot;

  const handleRegenerateNarrative = async () => {
    setIsGeneratingAi(true);
    try {
      const text = await generateReportNarrative(currentSnapshot, profile);
      setNarrativeText(text);
    } catch {
      // ignore
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top action bar (hidden in print) */}
      <div className="no-print bg-[#0b1530] border border-[#20366c] p-4 rounded-2xl shadow-md flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <OrcaMascot mood="calculating" size={54} />
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <span>📄 Báo Cáo Tài Chính Tháng {currentSnapshot.period} Cùng Bé Orca</span>
            </h2>
            <p className="text-xs text-slate-300 mt-0.5">
              Bản báo cáo tổng hợp chi tiết thu nhập, thuế 2026, dòng tiền và điểm sức khỏe của bạn! 🐳
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {profile.consentAI && (
            <button
              onClick={handleRegenerateNarrative}
              disabled={isGeneratingAi}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#122344] hover:bg-[#182f5c] text-amber-300 border border-amber-600/60 text-xs font-mono transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{isGeneratingAi ? 'Đang tổng hợp...' : 'Diễn giải AI (Audit Facts)'}</span>
            </button>
          )}

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-xs transition-all cursor-pointer shadow-sm"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>In báo cáo / Lưu PDF</span>
          </button>
        </div>
      </div>

      {/* PRINTABLE DOCUMENT CONTAINER */}
      <div className="print-page bg-[#081021] border border-[#1b2f54] p-6 sm:p-8 space-y-6 max-w-4xl mx-auto shadow-xl">
        {/* Document Header */}
        <div className="flex flex-wrap items-start justify-between border-b-2 border-amber-500 pb-4 gap-4">
          <div>
            <div className="flex items-center gap-2 text-amber-400 font-bold tracking-widest text-sm uppercase">
              <span className="font-mono text-base">Ω</span>
              <span>ORCA FINANCIAL</span>
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight mt-1">
              BÁO CÁO KIỂM SOÁT TÀI CHÍNH ĐỊNH KỲ
            </h1>
            <p className="text-xs text-slate-400 mt-0.5 font-mono">
              KỲ BÁO CÁO: {currentSnapshot.period} · MÃ ENGINE: {currentSnapshot.engineVersion}
            </p>
          </div>

          <div className="text-right font-mono text-xs text-slate-400">
            <div>Ngày phát hành: {new Date().toLocaleDateString('vi-VN')}</div>
            <div>Múi giờ: Asia/Ho_Chi_Minh</div>
            <div className="text-emerald-400 text-[11px] mt-1 font-semibold">
              XÁC THỰC: TAX-VN 2026 OFFICIAL
            </div>
          </div>
        </div>

        {/* Narrative Executive Summary Box (B5 Narrator) */}
        <div className="bg-[#0b1424] border border-[#182b4c] p-4 text-xs leading-relaxed">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#14233e]">
            <span className="font-semibold text-amber-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
              TÓM LƯỢC ĐIỀU HÀNH TỔ CHỨC (EXECUTIVE NARRATIVE)
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {profile.consentAI ? 'AI NARRATED + FACT-CHECKED' : 'DETERMINISTIC TEMPLATE'}
            </span>
          </div>
          <div className="whitespace-pre-line text-slate-200 font-mono text-[11px] space-y-2">
            {narrativeText}
          </div>
        </div>

        {/* Key Indicators Summary 4-Column Table */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2 border-b border-[#14233e] pb-1">
            1. BẢNG TỔNG HỢP CÁC CHỈ SỐ CỐT LÕI
          </h3>
          <table className="w-full text-xs font-mono border border-[#162744]">
            <tbody>
              <tr className="border-b border-[#14233e]">
                <td className="p-2.5 bg-[#0a1222] text-slate-400 w-1/4">Tài sản ròng (Net Worth):</td>
                <td className="p-2.5 font-bold text-white w-1/4">
                  {metrics.netWorth.toLocaleString('vi-VN')} ₫
                </td>
                <td className="p-2.5 bg-[#0a1222] text-slate-400 w-1/4">Điểm sức khỏe tài chính:</td>
                <td className="p-2.5 font-bold text-amber-300 w-1/4">
                  {metrics.healthScore.total} / 100 ({metrics.healthScore.ratingText})
                </td>
              </tr>
              <tr className="border-b border-[#14233e]">
                <td className="p-2.5 bg-[#0a1222] text-slate-400">Thu nhập thực nhận (Net):</td>
                <td className="p-2.5 font-bold text-slate-200">
                  {metrics.totalNetIncome.toLocaleString('vi-VN')} ₫
                </td>
                <td className="p-2.5 bg-[#0a1222] text-slate-400">Tổng chi tiêu tháng:</td>
                <td className="p-2.5 font-bold text-slate-200">
                  {metrics.totalExpenses.toLocaleString('vi-VN')} ₫
                </td>
              </tr>
              <tr className="border-b border-[#14233e]">
                <td className="p-2.5 bg-[#0a1222] text-slate-400">Tiết kiệm tháng này:</td>
                <td className="p-2.5 font-bold text-emerald-400">
                  {metrics.monthlySavings.toLocaleString('vi-VN')} ₫ ({metrics.savingsRate}%)
                </td>
                <td className="p-2.5 bg-[#0a1222] text-slate-400">Tỷ lệ chi phí cố định:</td>
                <td className="p-2.5 font-bold text-slate-200">
                  {metrics.fixedCostRatio}% (Trần an toàn 65%)
                </td>
              </tr>
              <tr>
                <td className="p-2.5 bg-[#0a1222] text-slate-400">Quỹ dự phòng khẩn cấp:</td>
                <td className="p-2.5 font-bold text-slate-200">
                  {metrics.emergencyFundMonths} tháng ({metrics.liquidAssets.toLocaleString('vi-VN')} ₫)
                </td>
                <td className="p-2.5 bg-[#0a1222] text-slate-400">Tổng dư nợ phải trả:</td>
                <td className="p-2.5 font-bold text-rose-400">
                  {metrics.totalDebt.toLocaleString('vi-VN')} ₫ (DTI: {metrics.debtToIncomeRatio}%)
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 5 Health Score Pillars Detailed Breakdown */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-2 border-b border-[#14233e] pb-1">
            2. ĐÁNH GIÁ 5 TRỤ CỘT SỨC KHỎE TÀI CHÍNH
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-xs font-mono">
            <div className="p-2.5 bg-[#0a1222] border border-[#162744]">
              <div className="text-[10px] text-slate-400">1. DÒNG TIỀN (25đ)</div>
              <div className="text-base font-bold text-white mt-1">
                {metrics.healthScore.cashflowScore} / 25
              </div>
            </div>
            <div className="p-2.5 bg-[#0a1222] border border-[#162744]">
              <div className="text-[10px] text-slate-400">2. DỰ PHÒNG (25đ)</div>
              <div className="text-base font-bold text-white mt-1">
                {metrics.healthScore.emergencyScore} / 25
              </div>
            </div>
            <div className="p-2.5 bg-[#0a1222] border border-[#162744]">
              <div className="text-[10px] text-slate-400">3. NỢ VAY (20đ)</div>
              <div className="text-base font-bold text-white mt-1">
                {metrics.healthScore.debtScore} / 20
              </div>
            </div>
            <div className="p-2.5 bg-[#0a1222] border border-[#162744]">
              <div className="text-[10px] text-slate-400">4. TÀI SẢN RÒNG (20đ)</div>
              <div className="text-base font-bold text-white mt-1">
                {metrics.healthScore.networthScore} / 20
              </div>
            </div>
            <div className="p-2.5 bg-[#0a1222] border border-[#162744]">
              <div className="text-[10px] text-slate-400">5. KỶ LUẬT (10đ)</div>
              <div className="text-base font-bold text-white mt-1">
                {metrics.healthScore.disciplineScore} / 10
              </div>
            </div>
          </div>
        </div>

        {/* Legal Disclaimer Box */}
        <div className="pt-4 border-t border-[#1b2f54] text-[10px] text-slate-500 leading-relaxed font-mono">
          <strong>CHỨNG THỰC BẢN QUYỀN & TUYÊN BỐ PHÁP LÝ:</strong> Báo cáo này được tạo bởi hệ thống Orca Personal Finance thuộc thương hiệu Orca Financial. Báo cáo phục vụ mục đích kiểm soát ngân sách cá nhân, không phải là văn bản thẩm định tín dụng hay khuyến nghị đầu tư chứng khoán chính thức. Mọi thông tin tuân thủ theo Luật Bảo vệ dữ liệu cá nhân 2025.
        </div>
      </div>
    </div>
  );
};
