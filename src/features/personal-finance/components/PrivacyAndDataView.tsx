import React, { useState } from 'react';
import { FinanceProfile, MonthlySnapshot } from '../types/finance.ts';
import { exportDataAsJson, exportDataAsCsv } from '../storage/financeStore.ts';
import {
  Shield,
  Download,
  Trash2,
  Lock,
  FileSpreadsheet,
  FileCode,
  CheckCircle2,
  AlertOctagon,
  Scale,
  RefreshCw,
} from 'lucide-react';

interface PrivacyAndDataViewProps {
  profile: FinanceProfile;
  snapshots: MonthlySnapshot[];
  onUpdateProfile: (p: FinanceProfile) => void;
  onWipeData: () => void;
}

export const PrivacyAndDataView: React.FC<PrivacyAndDataViewProps> = ({
  profile,
  snapshots,
  onUpdateProfile,
  onWipeData,
}) => {
  const [showWipeConfirm, setShowWipeConfirm] = useState<boolean>(false);
  const [wipeInput, setWipeInput] = useState<string>('');
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  // Toggle consent handler
  const handleToggleConsent = (field: 'consentStorage' | 'consentAI' | 'consentOpenBanking') => {
    const updated = {
      ...profile,
      [field]: !profile[field],
      updatedAt: new Date().toLocaleDateString('vi-VN'),
    };
    onUpdateProfile(updated);
  };

  // Export JSON
  const handleDownloadJson = () => {
    const jsonStr = exportDataAsJson(profile, snapshots);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orca_financial_export_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloadSuccess('Đã xuất thành công tệp sao lưu JSON!');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  // Export CSV
  const handleDownloadCsv = () => {
    const csvStr = exportDataAsCsv(snapshots);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orca_financial_history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloadSuccess('Đã xuất thành công tệp bảng tính CSV!');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  // Execute wipe
  const handleExecuteWipe = () => {
    if (wipeInput.trim() === 'DELETE') {
      onWipeData();
      setShowWipeConfirm(false);
      setWipeInput('');
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Privacy By Design Matrix (B7) */}
      <div className="bg-[#091120] border border-[#182b4c] p-5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-[#14233e]">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-100 flex items-center gap-2">
              <Shield className="w-4 h-4 text-amber-400" />
              QUYỀN RIÊNG TƯ THEO THIẾT KẾ & ĐỒNG Ý THEO MỤC ĐÍCH (PDPD 2025)
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Tuân thủ Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân 2025. Người dùng có toàn quyền bật/tắt hoặc rút lại sự đồng ý bất kỳ lúc nào.
            </p>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 border border-emerald-700/60">
            PRIVACY BY DESIGN
          </span>
        </div>

        <div className="space-y-3 text-xs">
          {/* Purpose 1: Storage */}
          <div className="p-3 bg-[#0a1222] border border-[#162744] flex items-center justify-between">
            <div className="space-y-0.5 max-w-2xl">
              <div className="font-semibold text-slate-200">
                1. Lưu trữ cục bộ & Đồng bộ bản chụp tài chính (Local Storage)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Cho phép hệ thống lưu trữ các chỉ số thu nhập, chi tiêu, tài sản và nợ trên trình duyệt của bạn. Hệ thống cam kết KHÔNG thu thập số tài khoản ngân hàng, số thẻ tín dụng hay số định danh cá nhân (CCCD).
              </p>
            </div>
            <button
              onClick={() => handleToggleConsent('consentStorage')}
              className={`px-3 py-1 text-xs font-mono border transition-colors cursor-pointer ${
                profile.consentStorage
                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300 font-bold'
                  : 'bg-rose-950 border-rose-600 text-rose-300'
              }`}
            >
              {profile.consentStorage ? 'ĐÃ ĐỒNG Ý' : 'TỪ CHỐI'}
            </button>
          </div>

          {/* Purpose 2: AI Narrator */}
          <div className="p-3 bg-[#0a1222] border border-[#162744] flex items-center justify-between">
            <div className="space-y-0.5 max-w-2xl">
              <div className="font-semibold text-slate-200">
                2. Phân tích & Diễn giải ngôn ngữ tự nhiên bằng AI (Narrator Engine)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Cho phép gửi các dữ kiện số học đã ẩn danh tuyệt đối (chỉ gồm số tiền và tỷ lệ %, không có tên hay email) đến LLM để diễn giải báo cáo. Mọi số liệu được kiểm toán trước khi xuất bản.
              </p>
            </div>
            <button
              onClick={() => handleToggleConsent('consentAI')}
              className={`px-3 py-1 text-xs font-mono border transition-colors cursor-pointer ${
                profile.consentAI
                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300 font-bold'
                  : 'bg-rose-950 border-rose-600 text-rose-300'
              }`}
            >
              {profile.consentAI ? 'ĐÃ ĐỒNG Ý' : 'TỪ CHỐI'}
            </button>
          </div>

          {/* Purpose 3: Open Banking / Future API */}
          <div className="p-3 bg-[#0a1222] border border-[#162744] flex items-center justify-between">
            <div className="space-y-0.5 max-w-2xl">
              <div className="font-semibold text-slate-200">
                3. Kết nối Open Banking theo lộ trình NHNN (Giai đoạn P4)
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Chuẩn bị sẵn sàng cho kết nối API ngân hàng mở theo khuôn khổ pháp lý của Ngân hàng Nhà nước. Hiện tại đang ở chế độ chờ kích hoạt.
              </p>
            </div>
            <button
              onClick={() => handleToggleConsent('consentOpenBanking')}
              className={`px-3 py-1 text-xs font-mono border transition-colors cursor-pointer ${
                profile.consentOpenBanking
                  ? 'bg-emerald-950 border-emerald-600 text-emerald-300 font-bold'
                  : 'bg-[#10192a] border-[#223558] text-slate-400'
              }`}
            >
              {profile.consentOpenBanking ? 'ĐÃ ĐỒNG Ý' : 'CHƯA KÍCH HOẠT'}
            </button>
          </div>
        </div>
      </div>

      {/* 2. Data Portability: Export JSON & CSV (B7) */}
      <div className="bg-[#091120] border border-[#182b4c] p-5 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-100 pb-2 border-b border-[#14233e] flex items-center gap-2">
          <Download className="w-4 h-4 text-amber-400" />
          XUẤT TOÀN BỘ DỮ LIỆU CÁ NHÂN (DATA PORTABILITY)
        </h3>

        <p className="text-xs text-slate-400">
          Bạn sở hữu 100% dữ liệu tài chính của mình. Bạn có thể tải về toàn bộ hồ sơ và lịch sử Monthly Check-in dưới định dạng mở bất kỳ lúc nào:
        </p>

        {downloadSuccess && (
          <div className="p-3 bg-emerald-950/80 border border-emerald-600 text-emerald-300 text-xs font-mono flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>{downloadSuccess}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 bg-[#0a1222] border border-[#162744] flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 font-semibold text-white text-xs mb-1">
                <FileCode className="w-4 h-4 text-amber-400" />
                <span>Xuất tệp JSON hoàn chỉnh</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                Bao gồm toàn bộ hồ sơ, cài đặt giả định, danh mục chi tiêu, tài sản, nợ và tất cả các kỳ snapshot có cấu trúc chuẩn.
              </p>
            </div>
            <button
              onClick={handleDownloadJson}
              className="flex items-center justify-center gap-1.5 w-full py-2 bg-[#122344] hover:bg-[#182f5c] text-amber-300 border border-amber-600/60 text-xs font-mono transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải xuống JSON (Backup đầy đủ)</span>
            </button>
          </div>

          <div className="p-4 bg-[#0a1222] border border-[#162744] flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-2 font-semibold text-white text-xs mb-1">
                <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
                <span>Xuất bảng tính CSV (Excel)</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                Bảng tính lịch sử dòng tiền theo từng tháng: Lương gross, bảo hiểm, thuế TNCN, thu nhập net, chi tiêu, tài sản ròng và điểm sức khỏe.
              </p>
            </div>
            <button
              onClick={handleDownloadCsv}
              className="flex items-center justify-center gap-1.5 w-full py-2 bg-[#102a20] hover:bg-[#15382b] text-emerald-300 border border-emerald-600/60 text-xs font-mono transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải xuống CSV (Phân tích Excel)</span>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Right to Erasure: One-click Wipe (B7) */}
      <div className="bg-[#091120] border border-rose-900/60 p-5 space-y-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-300 pb-2 border-b border-rose-950 flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-rose-400" />
          QUYỀN ĐƯỢC XÓA BỎ DỮ LIỆU HOÀN TOÀN (RIGHT TO ERASURE / ONE-CLICK WIPE)
        </h3>

        <p className="text-xs text-slate-400 leading-relaxed">
          Thực hiện quyền được quên theo Luật Bảo vệ dữ liệu cá nhân 2025. Thao tác này sẽ xóa vĩnh viễn toàn bộ hồ sơ, các kỳ Monthly Check-in và đưa hệ thống về trạng thái ban đầu mà không để lại bất kỳ bản sao nào.
        </p>

        {!showWipeConfirm ? (
          <button
            onClick={() => setShowWipeConfirm(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-950 hover:bg-rose-900 text-rose-200 border border-rose-700 text-xs font-mono transition-colors cursor-pointer"
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>Yêu cầu xóa toàn bộ dữ liệu tài khoản</span>
          </button>
        ) : (
          <div className="p-4 bg-rose-950/40 border border-rose-600 space-y-3 text-xs">
            <div className="font-bold text-rose-300">
              CẢNH BÁO: HÀNH ĐỘNG KHÔNG THỂ KHÔI PHỤC!
            </div>
            <p className="text-slate-300">
              Vui lòng gõ chữ <strong className="text-white font-mono bg-black px-1.5 py-0.5">DELETE</strong> vào ô bên dưới để xác nhận xóa vĩnh viễn:
            </p>
            <div className="flex items-center gap-2 max-w-sm">
              <input
                type="text"
                value={wipeInput}
                onChange={(e) => setWipeInput(e.target.value)}
                placeholder="Gõ DELETE để xác nhận"
                className="w-full bg-[#060b14] border border-rose-700 px-3 py-1.5 text-xs font-mono text-white focus:outline-none"
              />
              <button
                onClick={handleExecuteWipe}
                disabled={wipeInput.trim() !== 'DELETE'}
                className={`px-4 py-1.5 font-bold font-mono text-xs cursor-pointer ${
                  wipeInput.trim() === 'DELETE'
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg'
                    : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                }`}
              >
                XÁC NHẬN XÓA
              </button>
              <button
                onClick={() => {
                  setShowWipeConfirm(false);
                  setWipeInput('');
                }}
                className="px-3 py-1.5 bg-[#0e1a33] text-slate-300 border border-[#233a69] text-xs font-mono cursor-pointer"
              >
                Hủy
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 4. Legal Compliance Handover Notes (B7) */}
      <div className="bg-[#091120] border border-[#182b4c] p-4 text-xs font-mono text-slate-400 space-y-2">
        <div className="font-semibold text-slate-300 flex items-center gap-1.5">
          <Scale className="w-3.5 h-3.5 text-amber-400" />
          <span>GHI CHÚ PHÁP LÝ BÀN GIAO & TƯ VẤN LUẬT SƯ (B7 COMPLIANCE LOG):</span>
        </div>
        <p className="text-[11px] leading-relaxed">
          1. <strong>Lưu trữ dữ liệu:</strong> Toàn bộ dữ liệu tài chính nhạy cảm chỉ lưu trữ trong trình duyệt cục bộ của người dùng (Client-side Sandbox).
          <br />
          2. <strong>Ẩn danh AI:</strong> Dữ liệu chuyển tới AI Narrator được loại bỏ 100% định danh và kiểm toán số học đối chứng trước khi trả về.
          <br />
          3. <strong>Điểm cần tư vấn luật sư xác nhận khi đưa vào vận hành thương mại:</strong> Quy trình đăng ký đánh giá tác động xử lý dữ liệu cá nhân (DPIA) với Cục An ninh mạng và phòng chống tội phạm công nghệ cao (A05 - Bộ Công an) theo Nghị định 13/2023/NĐ-CP khi triển khai cổng kết nối Open Banking tập trung.
        </p>
      </div>
    </div>
  );
};
