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
    <header className="border-b border-[#28468c] bg-[#101e47]/95 backdrop-blur-md sticky top-0 z-20 shadow-lg">
      {/* Friendly, cute top bar — desktop only to maximize mobile vertical space */}
      <div className="hidden sm:flex border-b border-[#1c326c] px-4 py-2 items-center justify-between text-xs text-slate-200">
        <div className="flex items-center gap-2.5">
          <span className="text-sky-300 font-bold tracking-wide flex items-center gap-1.5 text-xs">
            <span>🐳</span>
            <span>Bé Orca Finance</span>
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 text-[11px]">
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
      <div className="px-3 sm:px-4 py-2 sm:py-3 flex flex-wrap items-center justify-between gap-2.5 sm:gap-4">
        <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
          <div className="shrink-0 scale-90 sm:scale-100 origin-left">
            <OrcaMascot mood="waving" size={42} />
          </div>
          
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h1 className="text-sm sm:text-lg font-bold text-white tracking-tight leading-tight truncate">
                Bé Orca Personal Finance
              </h1>
              <span className="text-[10px] sm:text-[11px] font-bold text-amber-300 bg-amber-400/20 px-1.5 sm:px-2 py-0.5 rounded-full border border-amber-400/30 font-mono shrink-0">
                Thuế 2026 ✨
              </span>
              {isDemo && (
                <span className="sm:hidden text-[9px] font-mono text-amber-300 bg-amber-400/15 px-1.5 py-0.5 rounded-full border border-amber-400/30">
                  Demo
                </span>
              )}
            </div>
            <p className="text-[11px] sm:text-xs text-slate-300 mt-0.5 hidden sm:block">
              Tính thuế TNCN 2026, dòng tiền và nuôi heo đất cùng Bé Orca nhen! 🐳💖
            </p>
          </div>
        </div>

        {/* Action controls — compact and aligned on mobile */}
        <div className="flex items-center flex-wrap gap-2 w-full sm:w-auto justify-between sm:justify-end">
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-[#172a5e] border border-[#2d4d99] px-2.5 py-1 sm:py-1.5 text-xs rounded-xl shadow-inner">
            <Calendar className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="text-slate-300 text-[11px] font-medium hidden xs:inline">Kỳ:</span>
            <select
              value={currentPeriod}
              onChange={(e) => onSelectPeriod(e.target.value)}
              className="bg-transparent text-amber-300 font-mono font-bold focus:outline-none cursor-pointer text-xs"
            >
              {availablePeriods.map((p) => (
                <option key={p} value={p} className="bg-[#101e47] text-slate-200">
                  {p} {p === '2026-10' ? '(Hiện tại)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Quick Check-in CTA button */}
            <button
              onClick={onStartCheckin}
              className="flex items-center gap-1.5 px-3 sm:px-4 py-1.5 sm:py-2 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md cursor-pointer active:scale-95"
            >
              <CheckCircle2 className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-slate-950 shrink-0" />
              <span>Check-in <span className="hidden xs:inline">(~5 ph)</span></span>
            </button>

            {/* Dataset switcher */}
            {isDemo ? (
              <button
                onClick={onStartBlank}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#172a5e] hover:bg-[#20397d] text-slate-200 hover:text-white border border-[#2d4d99] text-xs font-mono rounded-xl transition-colors cursor-pointer active:scale-95"
                title="Xóa dữ liệu mẫu và tự nhập số liệu của bạn"
              >
                <Trash2 className="w-3.5 h-3.5 text-slate-300" />
                <span className="hidden sm:inline">Nhập sổ của bạn</span>
                <span className="sm:hidden">Nhập sổ</span>
              </button>
            ) : (
              <button
                onClick={onLoadDemo}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-[#172a5e] hover:bg-[#20397d] text-amber-300 hover:text-amber-200 border border-amber-400/40 text-xs font-mono rounded-xl transition-colors cursor-pointer active:scale-95"
                title="Nạp lại bộ dữ liệu mẫu"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Xem mẫu Demo</span>
                <span className="sm:hidden">Mẫu</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Clean Navigation Tabs with Smooth Horizontal Touch-Scroll */}
      <div className="px-2.5 sm:px-3 flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar border-t border-[#1d346e] bg-[#0c183b] overscroll-contain">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`px-3 sm:px-3.5 py-2 text-[11px] sm:text-xs font-medium whitespace-nowrap transition-all border-b-2 cursor-pointer active:scale-95 shrink-0 ${
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
