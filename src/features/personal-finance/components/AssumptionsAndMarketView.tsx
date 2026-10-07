import React, { useState } from 'react';
import { AssumptionSet } from '../types/finance.ts';
import { OFFICIAL_MARKET_DATA } from '../engines/marketData.ts';
import { TAX_PARAMS_2026 } from '../engines/taxVnEngine.ts';
import {
  Globe,
  Settings,
  Scale,
  Save,
  RotateCcw,
  ExternalLink,
  ShieldCheck,
  Check,
} from 'lucide-react';
import { DEFAULT_ASSUMPTIONS } from '../engines/projectionEngine.ts';

interface AssumptionsAndMarketViewProps {
  assumptions: AssumptionSet;
  onSaveAssumptions: (newAssumptions: AssumptionSet) => void;
}

export const AssumptionsAndMarketView: React.FC<AssumptionsAndMarketViewProps> = ({
  assumptions,
  onSaveAssumptions,
}) => {
  const [formData, setFormData] = useState<AssumptionSet>(assumptions);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  const handleSave = () => {
    onSaveAssumptions(formData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  const handleReset = () => {
    setFormData(DEFAULT_ASSUMPTIONS);
    onSaveAssumptions(DEFAULT_ASSUMPTIONS);
  };

  return (
    <div className="space-y-6">
      {/* 1. Official Real Market Data Table (B2) */}
      <div className="bg-[#091120] border border-[#182b4c] p-4">
        <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#14233e]">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Globe className="w-4 h-4 text-amber-400" />
              DỮ LIỆU THỊ TRƯỜNG THỰC TẾ VIỆT NAM (NGUỒN MINH BẠCH & THỜI ĐIỂM CẬP NHẬT)
            </h3>
            <p className="text-[11px] text-slate-400">
              Tuân thủ B2: Mọi con số thị trường phải từ nguồn thật, kèm tên nguồn và thời điểm cập nhật.
            </p>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 border border-emerald-700/60">
            DỮ LIỆU CHÍNH THỨC
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono border-collapse">
            <thead>
              <tr className="bg-[#0d182e] border-b border-[#1c3258] text-slate-400 text-left">
                <th className="py-2.5 px-3">CHỈ SỐ THỊ TRƯỜNG</th>
                <th className="py-2.5 px-3 text-right">GIÁ TRỊ THỰC TẾ</th>
                <th className="py-2.5 px-3">BIẾN ĐỘNG</th>
                <th className="py-2.5 px-3">NGUỒN CÔNG BỐ</th>
                <th className="py-2.5 px-3">THỜI ĐIỂM CẬP NHẬT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#13223f]">
              {OFFICIAL_MARKET_DATA.map((item) => (
                <tr key={item.id} className="hover:bg-[#0c1628] transition-colors">
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-slate-200">{item.indicator}</div>
                    <div className="text-[10px] text-slate-500 font-sans">{item.description}</div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold text-amber-300">
                    {item.value} <span className="text-[10px] text-slate-400">{item.unit}</span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-300">{item.changeText}</td>
                  <td className="py-2.5 px-3 text-slate-300">
                    <div className="flex items-center gap-1">
                      <span>{item.sourceName}</span>
                      {item.sourceUrl && (
                        <a
                          href={item.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-slate-500 hover:text-amber-400"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">{item.updatedAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 2. Tax-VN 2026 Legal Parameters Table */}
      <div className="bg-[#091120] border border-[#182b4c] p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 pb-2 mb-3 border-b border-[#14233e] flex items-center gap-2">
          <Scale className="w-4 h-4 text-amber-400" />
          BẢNG THAM SỐ THUẾ TNCN & BẢO HIỂM BẮT BUỘC (CẤU HÌNH TAX_PARAMS/2026)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs font-mono">
          <div className="bg-[#0a1222] border border-[#162744] p-3 space-y-2">
            <span className="text-amber-300 font-bold block">GIẢM TRỪ GIA CẢNH (2026)</span>
            <div className="text-slate-300 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>• Giảm trừ bản thân:</span>
                <span className="font-bold text-white">15.500.000 ₫/tháng</span>
              </div>
              <div className="flex justify-between">
                <span>• Giảm trừ người phụ thuộc:</span>
                <span className="font-bold text-white">6.200.000 ₫/người</span>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 pt-1 border-t border-[#14233e]">
              Căn cứ: {TAX_PARAMS_2026.legalSources.taxAllowances}
            </div>
          </div>

          <div className="bg-[#0a1222] border border-[#162744] p-3 space-y-2">
            <span className="text-amber-300 font-bold block">MỨC TRẦN ĐÓNG BẢO HIỂM</span>
            <div className="text-slate-300 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span>• Trần BHXH & BHYT:</span>
                <span className="font-bold text-white">46.800.000 ₫/tháng</span>
              </div>
              <div className="flex justify-between">
                <span>• Trần BHTN (Vùng 1):</span>
                <span className="font-bold text-white">99.200.000 ₫/tháng</span>
              </div>
            </div>
            <div className="text-[10px] text-slate-500 pt-1 border-t border-[#14233e]">
              Căn cứ: {TAX_PARAMS_2026.legalSources.insurance}
            </div>
          </div>

          <div className="bg-[#0a1222] border border-[#162744] p-3 space-y-2">
            <span className="text-amber-300 font-bold block">BIỂU THUẾ 5 BẬC LŨY TIẾN</span>
            <div className="text-slate-300 space-y-0.5 text-[10px]">
              <div>• Bậc 1: Đến 10 triệu ₫ &rarr; 5%</div>
              <div>• Bậc 2: 10 tr - 30 triệu ₫ &rarr; 10%</div>
              <div>• Bậc 3: 30 tr - 60 triệu ₫ &rarr; 20%</div>
              <div>• Bậc 4: 60 tr - 100 triệu ₫ &rarr; 30%</div>
              <div>• Bậc 5: Trên 100 triệu ₫ &rarr; 35%</div>
            </div>
            <div className="text-[10px] text-slate-500 pt-1 border-t border-[#14233e]">
              Căn cứ: {TAX_PARAMS_2026.legalSources.taxBrackets}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Customizable Projection Assumptions */}
      <div className="bg-[#091120] border border-[#182b4c] p-4">
        <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-[#14233e] gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Settings className="w-4 h-4 text-amber-400" />
              THAM SỐ GIẢ ĐỊNH KINH TẾ (NGƯỜI DÙNG TỰ CHỈNH SỬA ĐƯỢC)
            </h3>
            <p className="text-[11px] text-slate-400">
              Áp dụng cho engine mô phỏng dài hạn Monte Carlo và tính toán quỹ hưu trí
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-1 px-3 py-1 bg-[#0e1a33] text-slate-300 hover:text-white border border-[#233a69] text-xs font-mono transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Khôi phục mặc định</span>
            </button>
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-amber-600 to-amber-500 text-slate-950 font-bold text-xs font-mono transition-all cursor-pointer shadow-sm"
            >
              {isSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isSaved ? 'Đã lưu' : 'Lưu giả định'}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs font-mono">
          <div>
            <label className="text-slate-400 block mb-1">Lạm phát bình quân (CPI %/năm)</label>
            <input
              type="number"
              step="0.1"
              value={formData.inflationRate}
              onChange={(e) => setFormData({ ...formData, inflationRate: Number(e.target.value) })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Tăng trưởng thu nhập (%/năm)</label>
            <input
              type="number"
              step="0.5"
              value={formData.salaryGrowthRate}
              onChange={(e) => setFormData({ ...formData, salaryGrowthRate: Number(e.target.value) })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Lợi suất Thận trọng (%/năm)</label>
            <input
              type="number"
              step="0.5"
              value={formData.returnsConservative}
              onChange={(e) => setFormData({ ...formData, returnsConservative: Number(e.target.value) })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Lợi suất Cơ sở (%/năm)</label>
            <input
              type="number"
              step="0.5"
              value={formData.returnsBase}
              onChange={(e) => setFormData({ ...formData, returnsBase: Number(e.target.value) })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Lợi suất Tăng trưởng (%/năm)</label>
            <input
              type="number"
              step="0.5"
              value={formData.returnsAggressive}
              onChange={(e) => setFormData({ ...formData, returnsAggressive: Number(e.target.value) })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Tuổi nghỉ hưu dự kiến</label>
            <input
              type="number"
              min="50"
              max="75"
              value={formData.retirementAge}
              onChange={(e) => setFormData({ ...formData, retirementAge: Number(e.target.value) })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Kỳ vọng sống bình quân (Tuổi)</label>
            <input
              type="number"
              min="70"
              max="100"
              value={formData.lifeExpectancy}
              onChange={(e) => setFormData({ ...formData, lifeExpectancy: Number(e.target.value) })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-white focus:outline-none"
            />
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Thời điểm cập nhật</label>
            <input
              type="text"
              value={formData.updatedAt}
              onChange={(e) => setFormData({ ...formData, updatedAt: e.target.value })}
              className="w-full bg-[#060b14] border border-[#1e335b] px-3 py-1.5 text-xs text-slate-400 focus:outline-none"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
