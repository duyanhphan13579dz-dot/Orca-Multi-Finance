import React, { useState } from 'react';
import { Insight } from '../types/finance.ts';
import { OrcaMascot } from './OrcaMascot.tsx';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Filter,
  Check,
  RotateCcw,
  Sparkles,
  Heart,
} from 'lucide-react';

interface AdviceViewProps {
  insights: Insight[];
  onToggleStatus: (id: string, newStatus: 'new' | 'completed' | 'dismissed') => void;
}

export const AdviceView: React.FC<AdviceViewProps> = ({ insights, onToggleStatus }) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'new' | 'completed' | 'dismissed'>('all');

  const filteredInsights = insights.filter((ins) => {
    if (filterStatus === 'all') return true;
    return ins.status === filterStatus;
  });

  const completedCount = insights.filter((i) => i.status === 'completed').length;
  const mascotMood = completedCount >= 2 ? 'cheering' : 'saving';
  const mascotBubble = completedCount > 0
    ? `Oa! Cậu đã hoàn thành ${completedCount} việc rồi nè! Bé Orca siêu tự hào về cậu luôn đó nha! 🐳🎉`
    : `Bé Orca đã chọn lọc 5 điều quan trọng nhất cho cậu nè! Cùng làm từng việc một với bé để túi tiền luôn rủng rỉnh nhen! 💖`;

  return (
    <div className="space-y-6">
      {/* Header bar with Mascot */}
      <div className="bg-[#142552] border border-[#2b4b96] p-5 rounded-2xl shadow-lg flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <OrcaMascot mood={mascotMood} size={84} bubbleText={mascotBubble} />
          <div>
            <h2 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
              <span>💡 Lời Khuyên Hành Động Cùng Bé Orca</span>
            </h2>
            <p className="text-xs text-sky-200 mt-1">
              Mỗi lời khuyên có số tiền và thời hạn rõ ràng để cậu dễ dàng làm theo từng bước nhen! 🐳
            </p>
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" />
            Lọc:
          </span>
          {(['all', 'new', 'completed', 'dismissed'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-xl border transition-all cursor-pointer font-medium ${
                filterStatus === st
                  ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold'
                  : 'bg-[#0f1d40] border-[#22376b] text-slate-400 hover:text-white'
              }`}
            >
              {st === 'all'
                ? `Tất cả (${insights.length})`
                : st === 'new'
                ? `Mới (${insights.filter((i) => i.status === 'new').length})`
                : st === 'completed'
                ? `Đã làm (${insights.filter((i) => i.status === 'completed').length})`
                : `Bỏ qua (${insights.filter((i) => i.status === 'dismissed').length})`}
            </button>
          ))}
        </div>
      </div>

      {filteredInsights.length === 0 ? (
        <div className="p-12 text-center bg-[#0b1530] border border-[#20366c] rounded-2xl text-slate-400 text-xs">
          Không có khuyến nghị nào trong mục này.
        </div>
      ) : (
        <div className="space-y-4">
          {filteredInsights.map((ins) => (
            <div
              key={ins.id}
              className={`bg-[#172a5a] border p-5 rounded-2xl transition-all shadow-md ${
                ins.status === 'completed'
                  ? 'border-emerald-500/80 bg-[#122744]'
                  : ins.status === 'dismissed'
                  ? 'border-slate-700 opacity-60'
                  : ins.severity === 'critical'
                  ? 'border-rose-500/90'
                  : 'border-[#2d4d98]'
              }`}
            >
              {/* Card top bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-[#243e7c]">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-slate-400">
                    #{ins.priorityOrder}
                  </span>
                  <span
                    className={`text-[10px] font-mono px-2.5 py-0.5 uppercase font-bold rounded-full border ${
                      ins.severity === 'critical'
                        ? 'border-rose-500/80 text-rose-300 bg-rose-950/60'
                        : ins.severity === 'warning'
                        ? 'border-amber-500/80 text-amber-300 bg-amber-950/60'
                        : 'border-emerald-500/80 text-emerald-300 bg-emerald-950/60'
                    }`}
                  >
                    {ins.severity === 'critical'
                      ? '⚡ ƯU TIÊN 1: RỦI RO CAO'
                      : ins.severity === 'warning'
                      ? '⚠️ CẢNH BÁO CẦN LƯU Ý'
                      : '🌱 TÍCH LŨY TĂNG TRƯỞNG'}
                  </span>
                  <h3 className="text-sm font-bold text-white">{ins.title}</h3>
                </div>

                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-slate-400 text-[11px]">MÃ: {ins.ruleCode}</span>
                  {ins.status === 'completed' && (
                    <span className="text-emerald-400 font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Đã hoàn thành
                    </span>
                  )}
                  {ins.status === 'dismissed' && (
                    <span className="text-slate-500">Đã bỏ qua</span>
                  )}
                </div>
              </div>

              {/* Strict 6-Part Content Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Left Column: Finding & Impact */}
                <div className="space-y-3">
                  <div className="bg-[#081124] border border-[#1a2d5a] p-3.5 rounded-xl">
                    <span className="text-slate-400 font-bold block mb-1">
                      1. PHÁT HIỆN TỪ SỐ LIỆU:
                    </span>
                    <p className="text-slate-200 leading-relaxed font-sans">{ins.content.finding}</p>
                  </div>

                  <div className="bg-[#081124] border border-[#1a2d5a] p-3.5 rounded-xl">
                    <span className="text-slate-400 font-bold block mb-1">
                      2. TÁC ĐỘNG TÀI CHÍNH:
                    </span>
                    <p className="text-slate-300 leading-relaxed font-sans">{ins.content.impact}</p>
                  </div>
                </div>

                {/* Right Column: Action, Amount, Deadline & Assumptions */}
                <div className="space-y-3">
                  <div className="bg-[#081124] border border-[#1a2d5a] p-3.5 rounded-xl">
                    <span className="text-amber-400 font-bold block mb-1 flex items-center gap-1">
                      <span>✨ 3. HÀNH ĐỘNG CỤ THỂ BẠN NÊN LÀM:</span>
                    </span>
                    <p className="text-white leading-relaxed font-sans font-medium">{ins.content.action}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2.5 font-mono text-[11px]">
                    <div className="bg-[#081124] border border-[#1a2d5a] p-2.5 rounded-xl">
                      <span className="text-slate-400 block text-[10px]">4. SỐ TIỀN:</span>
                      <span className="text-white font-bold text-xs">
                        {ins.content.amount.toLocaleString('vi-VN')} ₫
                      </span>
                    </div>

                    <div className="bg-[#081124] border border-[#1a2d5a] p-2.5 rounded-xl">
                      <span className="text-slate-400 block text-[10px]">5. THỜI HẠN:</span>
                      <span className="text-amber-300 font-semibold text-xs truncate block">
                        {ins.content.deadline}
                      </span>
                    </div>
                  </div>

                  <div className="bg-[#081124] border border-[#1a2d5a] p-2.5 rounded-xl text-[10px] text-slate-400 font-mono">
                    <strong>6. Giả định & Mức tin cậy:</strong> {ins.content.assumptionsAndConfidence}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-4 pt-3 border-t border-[#182852] flex items-center justify-end gap-2 text-xs font-mono">
                {ins.status !== 'completed' ? (
                  <button
                    onClick={() => onToggleStatus(ins.id, 'completed')}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-950 hover:bg-emerald-900 text-emerald-300 border border-emerald-600 rounded-xl transition-all cursor-pointer font-bold"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Đánh dấu đã thực hiện xong 🎉</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleStatus(ins.id, 'new')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#122248] text-slate-300 hover:text-white border border-[#2b4788] rounded-xl transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Đánh dấu lại là mới</span>
                  </button>
                )}

                {ins.status !== 'dismissed' ? (
                  <button
                    onClick={() => onToggleStatus(ins.id, 'dismissed')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#121c33] text-slate-400 hover:text-slate-200 border border-[#202f50] rounded-xl transition-colors cursor-pointer"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Bỏ qua</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onToggleStatus(ins.id, 'new')}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#122248] text-slate-300 hover:text-white border border-[#2b4788] rounded-xl transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Khôi phục</span>
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
