import React from 'react';
import { Shield, Building2, Mail, Heart } from 'lucide-react';
import { OrcaMascot } from './OrcaMascot.tsx';

export const Footer: React.FC = () => {
  return (
    <footer className="border-t border-[#1e346b] bg-[#070e20] text-slate-300 text-xs py-8 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto space-y-5">
        {/* Cute Mascot Greeting in Footer */}
        <div className="p-4 bg-[#0c1630] border border-[#233a75] rounded-2xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <OrcaMascot mood="happy" size={50} />
            <div>
              <div className="text-white font-bold text-sm flex items-center gap-1.5">
                <span>Orca Personal Finance · Bé Orca đồng hành cùng bạn</span>
                <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                Mỗi tháng một lần Monthly Check-in để cùng bé Orca nuôi heo đất và kiến tạo tự do tài chính nhé! 🐳✨
              </p>
            </div>
          </div>
          <div className="text-right text-[11px] font-mono text-amber-300">
            ENGINE v2026.1 · TAX-VN 2026 OFFICIAL
          </div>
        </div>

        {/* Regulatory & disclaimer strip */}
        <div className="p-3.5 bg-[#0a1226] border border-[#1b2d58] text-[11px] leading-relaxed text-slate-300 rounded-xl">
          <div className="flex items-start gap-2">
            <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-300 uppercase tracking-wider">
                TUYÊN BỐ MIỄN TRỪ TRÁCH NHIỆM & GIÁO DỤC TÀI CHÍNH (DISCLAIMER):
              </span>{' '}
              Orca Personal Finance là ứng dụng giáo dục tài chính và hoạch định dòng tiền cá nhân. Ứng dụng{' '}
              <strong className="text-white">KHÔNG PHẢI</strong> là tổ chức tư vấn đầu tư chứng khoán có cấp phép và{' '}
              <strong className="text-white">KHÔNG</strong> khuyến nghị mua bán bất kỳ mã cổ phiếu hay sản phẩm đầu tư cụ thể nào. Quyết định phân bổ ngân sách hoàn toàn thuộc quyền tự chủ của người sử dụng.
            </div>
          </div>
        </div>

        {/* Corporate & contact info */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2 text-[11px] text-slate-300 border-t border-[#142348]">
          <div>
            <div className="font-semibold text-white mb-1 flex items-center gap-1.5">
              <span>🐳 ORCA FINANCIAL VIETNAM</span>
            </div>
            <p className="text-slate-400">
              Bạn đồng hành tài chính thông minh và đáng yêu dành cho người dùng Việt Nam.
            </p>
          </div>

          <div>
            <div className="font-semibold text-white mb-1 flex items-center gap-1">
              <Building2 className="w-3.5 h-3.5 text-amber-400" />
              <span>TRỤ SỞ LIÊN HỆ</span>
            </div>
            <p className="text-slate-300">Tầng 28, Tòa nhà Bitexco Financial Tower</p>
            <p className="text-slate-400">Số 2 Hải Triều, Quận 1, TP. Hồ Chí Minh</p>
          </div>

          <div>
            <div className="font-semibold text-white mb-1 flex items-center gap-1">
              <Mail className="w-3.5 h-3.5 text-amber-400" />
              <span>HỖ TRỢ & BẢO MẬT</span>
            </div>
            <p className="font-mono text-slate-200">support@orcafinancial.vn</p>
            <p className="text-slate-400">Quyền riêng tư: privacy@orcafinancial.vn</p>
          </div>

          <div>
            <div className="font-semibold text-white mb-1">TIÊU CHUẨN BẢO MẬT</div>
            <p className="text-slate-300">Luật Bảo vệ Dữ liệu Cá nhân 2025 (PDPD)</p>
            <p className="text-slate-400 font-mono">Múi giờ: Asia/Ho_Chi_Minh</p>
          </div>
        </div>

        {/* Copyright strip */}
        <div className="pt-2 flex flex-wrap items-center justify-between text-[11px] text-slate-400 border-t border-[#121f40]">
          <div>
            © 2026 Orca Financial Technologies Co., Ltd. Tận tâm vì sự tự do tài chính của bạn.
          </div>
          <div className="flex items-center gap-4 font-mono text-[11px]">
            <span>ENGINE: v2026.1</span>
            <span>·</span>
            <span>ZERO BANK ACCOUNT STORAGE</span>
            <span>·</span>
            <span className="text-amber-300">BÉ ORCA 💖</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
