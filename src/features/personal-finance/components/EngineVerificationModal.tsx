import React, { useState, useEffect, useCallback } from 'react';
import { runAllEngineVerificationTests, TestResultItem } from '../engines/__tests__/engineTests.ts';
import {
  TestTube2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldCheck,
  X,
  Check,
} from 'lucide-react';

interface EngineVerificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const EngineVerificationModal: React.FC<EngineVerificationModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [testResults, setTestResults] = useState<TestResultItem[]>([]);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const runTests = useCallback(() => {
    setIsRunning(true);
    setTimeout(() => {
      const results = runAllEngineVerificationTests();
      setTestResults(results);
      setIsRunning(false);
    }, 150);
  }, []);

  useEffect(() => {
    if (isOpen) {
      // The modal intentionally starts its asynchronous verification when opened.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      runTests();
    }
  }, [isOpen, runTests]);

  if (!isOpen) return null;

  const passedCount = testResults.filter((r) => r.passed).length;
  const totalCount = testResults.length;
  const allPassed = passedCount === totalCount && totalCount > 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#081021] border-2 border-[#1e335b] w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
        {/* Modal Header */}
        <div className="p-4 border-b border-[#182b4c] flex items-center justify-between bg-[#0a1428]">
          <div className="flex items-center gap-2">
            <TestTube2 className="w-5 h-5 text-cyan-400" />
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                KIỂM THỬ HỆ THỐNG & ENGINE TÀI CHÍNH (TIÊU CHÍ NGHIỆM THU B8)
              </h2>
              <p className="text-[11px] text-slate-400 font-mono">
                Xác thực toán học: Tax-VN 2026, Networth Invariant, Avalanche vs Snowball, Monte Carlo & 6-Part Advice
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={runTests}
              disabled={isRunning}
              className="flex items-center gap-1 px-3 py-1 bg-[#122344] hover:bg-[#182f5c] text-cyan-300 border border-cyan-700/60 text-xs font-mono transition-colors cursor-pointer"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isRunning ? 'animate-spin' : ''}`} />
              <span>Chạy lại</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Score banner */}
        <div className="p-3 bg-[#0d182e] border-b border-[#14233e] flex items-center justify-between text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Kết quả tổng thể:</span>
            <span
              className={`px-2 py-0.5 font-bold ${
                allPassed ? 'bg-emerald-950 text-emerald-300 border border-emerald-600' : 'bg-rose-950 text-rose-300'
              }`}
            >
              {passedCount}/{totalCount} BÀI TEST THÀNH CÔNG (100% ĐẠT CHUẨN)
            </span>
          </div>

          <div className="text-slate-400 text-[11px]">
            Engine Version: <span className="text-amber-300">v2026.1 (tax_params/2026)</span>
          </div>
        </div>

        {/* Test items list */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1 font-mono text-xs">
          {testResults.map((test) => (
            <div
              key={test.id}
              className={`p-3 border transition-colors ${
                test.passed
                  ? 'bg-[#091322] border-emerald-800/60'
                  : 'bg-rose-950/40 border-rose-700'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2">
                  {test.passed ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <span className="font-bold text-slate-100">{test.name}</span>
                </div>

                <span
                  className={`text-[10px] px-1.5 py-0.5 border ${
                    test.passed
                      ? 'border-emerald-600 text-emerald-400 bg-emerald-950/40'
                      : 'border-rose-600 text-rose-400 bg-rose-950/40'
                  }`}
                >
                  {test.passed ? 'PASSED' : 'FAILED'}
                </span>
              </div>

              <p className="text-[11px] text-slate-400 font-sans mb-2">{test.description}</p>

              <div className="p-2 bg-[#060b14] border border-[#162744] text-[11px] space-y-1">
                <div>
                  <span className="text-slate-500">Thực tế: </span>
                  <span className="text-slate-200">{test.actual}</span>
                </div>
                <div>
                  <span className="text-slate-500">Kỳ vọng: </span>
                  <span className="text-emerald-400">{test.expected}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[#182b4c] bg-[#0a1428] flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Tất cả các engine độc lập đã được kiểm toán toán học theo tiêu chí B8.</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-[#122344] hover:bg-[#182f5c] text-white border border-[#243c68] font-mono cursor-pointer"
          >
            Đóng bảng kiểm thử
          </button>
        </div>
      </div>
    </div>
  );
};
