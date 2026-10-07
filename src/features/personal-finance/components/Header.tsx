import React from 'react';
import {
  Calendar,
  CheckCircle2,
  TestTube2,
  RefreshCw,
  Trash2,
  Sparkles,
  Heart,
} from 'lucide-react';
import { OrcaMascot } from './OrcaMascot.tsx';

interface HeaderProps {
  currentPeriod: string;
  availablePeriods: string[];
  onSelectPeriod: (p: string) => void;
  activeTab: string;
  onSelectTab: (t: string) => void;
  isDemo: boolean;
  onLoadDemo: () => void;
  onStartBlank: () => void;
  onOpenTestModal: () => void;
  onStartCheckin: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentPeriod,
  availablePeriods,
  onSelectPeriod,
  activeTab,
  onSelectTab,
  isDemo,
  onLoadDemo,
  onStartBlank,
  onOpenTestModal,
  onStartCheckin,
}) => {
  const tabs = [
    { id: 'dashboard', label: '🏠 Tổng quan' },
    { id: 'ask_orca', label: '💬 Bé Orca AI Tư Vấn' },
    { id: 'cashflow_calc', label: '⚡ Tính dòng tiền & Thuế' },
    { id: 'checkin', label: '📝 Monthly Check-in' },
    { id: 'analytics', label: '📊 Phân tích tài chính' },
    { id: 'planning', label: '🎯 Kế hoạch & Hưu trí' },
    { id: 'advice', label: '💡 Lời khuyên Bé Orca' },
    { id: 'report', label: '📄 Báo cáo & PDF' },
    { id: 'market', label: '⚙️ Giả định & Thị trường' },
    { id: 'privacy', label: '🔒 Quyền riêng tư' },
  ];

  return (
    <header className="border-b border-[#28468c] bg-[#101e47]/95 backdrop-blur-md sticky top-0 z-40 shadow-lg">
      {/* Friendly, cute top bar */}
      <div className="border-b border-[#1c326c] px-4 py-2 flex flex-wrap items-center justify-between text-xs text-slate-200">
        <div className="flex items-center gap-2.5">
          <span className="text-sky-300 font-bold tracking-wide flex items-center gap-1.5 text-xs">
            <span>🐳</span>
            <span>Bé Orca Finance</span>
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 text-[11px] hidden sm:inline">
            Cùng cậu quản lý túi tiền mỗi ngày nhen! ✨
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            {isDemo ? (
              <span className="bg-amber-400/20 text-amber-300 border border-amber-400/40 px-2.5 py-0.5 text-[10px] font-mono rounded-full font-bold">
                ⭐ Dữ liệu mẫu (Demo)
              </span>
            ) : (
              <span className="bg-emerald-400/20 text-emerald-300 border border-emerald-400/40 px-2.5 py-0.5 text-[10px] font-mono rounded-full font-bold">
                🌱 Sổ tay của bạn
              </span>
            )}

            <button
              onClick={onOpenTestModal}
              title="Kiểm tra độ chính xác công thức toán học"
              className="flex items-center gap-1 text-[11px] font-mono text-sky-200 hover:text-white px-2.5 py-0.5 bg-[#172c63] border border-sky-400/30 hover:border-sky-400 rounded-full transition-colors cursor-pointer"
            >
              <TestTube2 className="w-3 h-3 text-sky-300" />
              <span>Kiểm thử Engine (8/8)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main command bar with adorable Bé Orca */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <OrcaMascot mood="waving" size={56} />
          
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight leading-tight flex items-center gap-1.5">
                <span>Bé Orca Personal Finance</span>
              </h1>
              <span className="text-[11px] font-bold text-amber-300 bg-amber-400/20 px-2 py-0.5 rounded-full border border-amber-400/30 font-mono">
                Chuẩn thuế 2026 ✨
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Tính thuế TNCN 2026, dòng tiền và nuôi heo đất cùng Bé Orca nhen! 🐳💖
            </p>
          </div>
        </div>

        {/* Action controls */}
        <div className="flex items-center flex-wrap gap-2.5">
          {/* Period selector */}
          <div className="flex items-center gap-1.5 bg-[#172a5e] border border-[#2d4d99] px-3 py-1.5 text-xs rounded-xl shadow-inner">
            <Calendar className="w-3.5 h-3.5 text-amber-300" />
            <span className="text-slate-300 text-[11px] font-medium">Kỳ:</span>
            <select
              value={currentPeriod}
              onChange={(e) => onSelectPeriod(e.target.value)}
              className="bg-transparent text-amber-300 font-mono font-bold focus:outline-none cursor-pointer text-xs"
            >
              {availablePeriods.map((p) => (
                <option key={p} value={p} className="bg-[#101e47] text-slate-200">
                  {p} {p === '2026-10' ? '(Tháng này)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Quick Ask Bé Orca AI CTA button */}
          <button
            onClick={() => onSelectTab('ask_orca')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-[#1c387b] hover:bg-[#254ca6] text-sky-200 hover:text-white border border-sky-400/40 text-xs font-bold rounded-xl transition-all shadow-md cursor-pointer hover:scale-105"
            title="Hỏi Bé Orca về phân bổ lương, thưởng, mua sắm và mục tiêu cuộc sống"
          >
            <span>💬 Hỏi Bé Orca AI</span>
          </button>

          {/* Quick Check-in CTA button */}
          <button
            onClick={onStartCheckin}
            className="flex items-center gap-1.5 px-4 py-2 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md cursor-pointer hover:scale-105"
          >
            <CheckCircle2 className="w-4 h-4 text-slate-950" />
            <span>Monthly Check-in (~5 ph)</span>
          </button>

          {/* Dataset switcher */}
          {isDemo ? (
            <button
              onClick={onStartBlank}
              className="flex items-center gap-1 px-3 py-1.5 bg-[#172a5e] hover:bg-[#20397d] text-slate-200 hover:text-white border border-[#2d4d99] text-xs font-mono rounded-xl transition-colors cursor-pointer"
              title="Xóa dữ liệu mẫu và tự nhập số liệu của bạn"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-300" />
              <span>Nhập sổ của bạn</span>
            </button>
          ) : (
            <button
              onClick={onLoadDemo}
              className="flex items-center gap-1 px-3 py-1.5 bg-[#172a5e] hover:bg-[#20397d] text-amber-300 hover:text-amber-200 border border-amber-400/40 text-xs font-mono rounded-xl transition-colors cursor-pointer"
              title="Nạp lại bộ dữ liệu mẫu"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Xem mẫu Demo</span>
            </button>
          )}
        </div>
      </div>

      {/* Clean Navigation Tabs */}
      <div className="px-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-[#1d346e] bg-[#0c183b]">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-all border-b-2 cursor-pointer ${
                isActive
                  ? 'border-amber-400 text-amber-300 font-bold bg-[#1a2e63] rounded-t-xl'
                  : 'border-transparent text-slate-300 hover:text-white hover:bg-[#13234d]'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </header>
  );
};
