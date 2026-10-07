import React, { useState, useRef, useEffect } from 'react';
import { MonthlySnapshot, FinanceProfile } from '../types/finance.ts';
import { OrcaMascot, MascotMood } from './OrcaMascot.tsx';
import { formatVND } from '../utils/formatters.ts';
import {
  Send,
  Sparkles,
  Bot,
  User,
  Copy,
  Check,
  RotateCcw,
  Lightbulb,
  Heart,
  HelpCircle,
  Coins,
  ShieldCheck,
  ShieldAlert,
  TrendingUp,
  Zap,
  ArrowRight,
  MapPin,
  Users,
  Target,
  Sliders,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  sender: 'user' | 'orca';
  text: string;
  timestamp: string;
  mood?: MascotMood;
}

interface AskOrcaAiViewProps {
  currentSnapshot: MonthlySnapshot;
  profile: FinanceProfile;
  onNavigateToCalculator?: () => void;
  onNavigateToCheckin?: () => void;
}

const PRESET_QUESTIONS = [
  {
    category: '💰 Lương & Chi tiêu',
    label: 'Lương thực nhận của mình nên chia 50/30/20 ra sao?',
    question: 'Dựa trên mức lương thực nhận và chi tiêu thực tế hiện tại của mình trong sổ, Bé Orca hãy tính bảng phân bổ 50/30/20 chi tiết đến từng đồng VND và chỉ ra khoản chi nào của mình đang vượt chuẩn nha!',
  },
  {
    category: '💰 Lương & Chi tiêu',
    label: 'Quy tắc 6 chiếc lọ (JARS) áp dụng vào mình thế nào?',
    question: 'Bé Orca hãy chia nhỏ thu nhập hiện tại của mình thành 6 chiếc lọ (JARS) với số tiền VND cụ thể cho từng lọ, và so sánh với các khoản chi cố định mình đang trả mỗi tháng nhen!',
  },
  {
    category: '🎁 Thưởng & Tiền nhàn rỗi',
    label: 'Vừa nhận thưởng 20 triệu nên phân bổ thế nào?',
    question: 'Mình vừa nhận được khoản thưởng 20 triệu đồng. Nhìn vào tình trạng quỹ khẩn cấp và nợ vay hiện tại của mình, Bé Orca khuyên mình nên chia khoản này thế nào để vừa an toàn vừa được tự thưởng?',
  },
  {
    category: '🎁 Thưởng & Tiền nhàn rỗi',
    label: 'Có 50 triệu nên gửi tiết kiệm hay mua vàng?',
    question: 'Mình đang có 50 triệu tiền nhàn rỗi, đang phân vân giữa gửi tiết kiệm ngân hàng, mua vàng nhẫn hay quỹ mở. Dựa trên quỹ dự phòng hiện có của mình, Bé Orca tư vấn tỷ lệ phân bổ an toàn nha!',
  },
  {
    category: '🚗 Mua sắm lớn',
    label: 'Với dòng tiền hiện tại, mình có nên mua xe trả góp?',
    question: 'Nhìn vào số tiền dư hàng tháng và chi phí cố định hiện tại của mình, Bé Orca tính giúp xem mình có đủ sức gánh khoản trả góp mua xe máy/ô tô không, và mức trả góp tối đa an toàn là bao nhiêu?',
  },
  {
    category: '🛡️ Nợ & Dự phòng',
    label: 'Chiến lược xử lý nợ và gia cố quỹ khẩn cấp?',
    question: 'Bé Orca xem giúp cơ cấu nợ và quỹ khẩn cấp hiện tại của mình, chỉ cho mình lộ trình dập nợ và tăng quỹ dự phòng nhanh nhất trong 6 tháng tới mà không bị kiệt quệ tài chính nhen!',
  },
];

export const AskOrcaAiView: React.FC<AskOrcaAiViewProps> = ({
  currentSnapshot,
  profile,
  onNavigateToCalculator,
  onNavigateToCheckin,
}) => {
  // Financial metrics calculated from current snapshot
  const netIncome = currentSnapshot.income.netTakeHome;
  const totalExpenses = currentSnapshot.metrics.totalExpenses;
  const fixedExpenses = currentSnapshot.expenses
    .filter((e) => e.isFixed)
    .reduce((sum, e) => sum + e.amount, 0);
  const variableExpenses = totalExpenses - fixedExpenses;
  const fixedCostRatio = netIncome > 0 ? Math.round((fixedExpenses / netIncome) * 100) : 0;
  const emergencyMonths = currentSnapshot.metrics.emergencyFundMonths;
  const totalDebt = currentSnapshot.metrics.totalDebt;
  const savingsRate = currentSnapshot.metrics.savingsRate;
  const monthlySavings = currentSnapshot.metrics.monthlySavings;

  // Living context state for tailoring responses
  const [location, setLocation] = useState<string>('Hà Nội / TP.HCM (Mức sống cao)');
  const [lifeStage, setLifeStage] = useState<string>('Độc thân (Ưu tiên tích lũy)');
  const [primaryPriority, setPrimaryPriority] = useState<string>('Cân bằng & Tích lũy tài sản');
  const [showContextCustomizer, setShowContextCustomizer] = useState<boolean>(false);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: 'welcome',
      sender: 'orca',
      mood: 'happy',
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      text: `Oa chào cậu nha! Bé Orca đã nạp toàn bộ số liệu sổ kỳ ${currentSnapshot.period} của cậu rồi nè! 🐳💖

Hiện tại Bé Orca đang nắm các con số thực tế của cậu:
• Lương thực nhận về ví: ${formatVND(netIncome)}/tháng.
• Chi phí sinh hoạt: ${formatVND(totalExpenses)} (Trong đó chi cố định chiếm ${fixedCostRatio}% lương).
• Đệm an toàn dự phòng: ${emergencyMonths} tháng chi tiêu.
${totalDebt > 0 ? `• Dư nợ đang theo dõi: ${formatVND(totalDebt)}.\n` : ''}
Bất kỳ câu hỏi nào cậu đặt ra (chia lương, phân bổ thưởng Tết, tính mua xe trả góp hay xử lý nợ), Bé Orca sẽ tính toán trực tiếp trên số tiền thật này của cậu, không hề nói chung chung đâu nhen! Cậu bấm câu hỏi gợi ý bên dưới hoặc gõ tự do nhé! ✨`,
    },
  ]);

  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [useCurrentSnapshotContext, setUseCurrentSnapshotContext] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageSequence = useRef(0);
  const nextMessageId = (kind: string) => {
    messageSequence.current += 1;
    return `${kind}-${messageSequence.current}`;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText || inputValue).trim();
    if (!textToSend || isLoading) return;

    const userMessage: ChatMessage = {
      id: nextMessageId('user'),
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    if (!queryText) setInputValue('');
    setIsLoading(true);

    try {
      // Chuẩn bị toàn bộ bối cảnh tài chính sâu sắc
      const snapshotFacts = useCurrentSnapshotContext
        ? {
            period: currentSnapshot.period,
            totalGrossSalary: currentSnapshot.income.grossSalary,
            totalNetIncome: netIncome,
            totalExpenses,
            fixedExpenses,
            variableExpenses,
            fixedCostRatio,
            savingsRate,
            monthlySavings,
            netWorth: currentSnapshot.metrics.netWorth,
            liquidAssets: currentSnapshot.metrics.liquidAssets,
            totalDebt,
            emergencyFundMonths: emergencyMonths,
            healthScore: currentSnapshot.metrics.healthScore.total,
            healthRating: currentSnapshot.metrics.healthScore.ratingText,
            dependents: profile.dependentsCount,
            maritalStatus: profile.maritalStatus,
            employmentType: profile.employmentType,
            location,
            lifeStage,
            primaryPriority,
            debtsList: currentSnapshot.debts.map((d) => ({
              name: d.name,
              category: d.category,
              balance: d.balance,
              interestRate: d.interestRate,
              minMonthlyPayment: d.minMonthlyPayment,
            })),
            expensesList: currentSnapshot.expenses.map((e) => ({
              name: e.name,
              category: e.category,
              amount: e.amount,
              isFixed: e.isFixed,
            })),
            goalsList: currentSnapshot.goals.map((g) => ({
              name: g.name,
              targetAmount: g.targetAmount,
              accumulatedAmount: g.accumulatedAmount,
              deadline: g.deadline,
              status: g.status,
            })),
          }
        : undefined;

      // Gửi cả lịch sử 4 tin nhắn gần nhất để giữ liền mạch ngữ cảnh hội thoại
      const conversationHistory = newMessages.slice(-4).map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const res = await fetch('/api/ask-orca', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: textToSend,
          snapshotFacts,
          conversationHistory,
        }),
      });

      if (!res.ok) {
        throw new Error('Server returned ' + res.status);
      }

      const data = await res.json();
      const answerText = data.answer || 'Bé Orca đang suy nghĩ một chút nè, cậu thử hỏi lại bé nha! 🐳';

      const orcaMessage: ChatMessage = {
        id: nextMessageId('orca'),
        sender: 'orca',
        text: answerText,
        mood:
          answerText.includes('giỏi') || answerText.includes('chúc mừng')
            ? 'cheering'
            : answerText.includes('cảnh báo') || answerText.includes('nguy hiểm')
            ? 'caution'
            : 'happy',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, orcaMessage]);
    } catch (err) {
      console.error('Lỗi khi gọi Bé Orca AI:', err);
      // Fallback sâu sát bối cảnh
      const fallbackText = `Chào cậu nhen! Bé Orca đã phân tích trực tiếp theo sổ kỳ ${currentSnapshot.period} của cậu nè: 🐳✨

🐳 1. NHẬN DIỆN BỐI CẢNH CỦA CẬU:
• Lương thực nhận hiện tại: ${formatVND(netIncome)}/tháng (${location}).
• Chi phí sinh hoạt: ${formatVND(totalExpenses)} (Chi cố định đang chiếm ${fixedCostRatio}% lương).
• Đệm an toàn: ${emergencyMonths} tháng chi tiêu.

📊 2. BẢNG PHÂN BỔ ĐO NI ĐÓNG GIÀY:
• 🏠 Thiết yếu bắt buộc (50%): ${formatVND(Math.round(netIncome * 0.5))} (Cậu đang chi ${formatVND(fixedExpenses)}, ${fixedExpenses > netIncome * 0.5 ? 'hơi cao, cần tối ưu' : 'rất an toàn'}).
• 🐷 Nuôi heo đất & Đầu tư (20%): ${formatVND(Math.round(netIncome * 0.2))} (Ưu tiên gia cố quỹ khẩn cấp lên đủ 3-6 tháng).
• ☕ Chi tiêu linh hoạt (30%): ${formatVND(Math.round(netIncome * 0.3))} cho tận hưởng cuộc sống và học tập.

✨ 3. HÀNH ĐỘNG TUẦN NÀY:
Trích ngay ${formatVND(Math.round(netIncome * 0.2))} vào tài khoản tiết kiệm riêng ngay ngày nhận lương nhé! 💖`;

      const orcaMessage: ChatMessage = {
        id: nextMessageId('orca'),
        sender: 'orca',
        text: fallbackText,
        mood: 'happy',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, orcaMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleResetChat = () => {
    setMessages([
      {
        id: 'welcome-reset',
        sender: 'orca',
        mood: 'happy',
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
        text: `Chào cậu nha! Tụi mình bắt đầu chủ đề mới nhen! Bé Orca vẫn đang giữ các số liệu tài chính kỳ ${currentSnapshot.period} của cậu sẵn sàng nè, cậu muốn bé tính toán bài toán nào? 🐳✨`,
      },
    ]);
  };

  return (
    <div className="space-y-5">
      {/* Friendly Header with Bé Orca Mascot */}
      <div className="bg-gradient-to-r from-[#17306b] via-[#1c3a82] to-[#173270] border border-[#2d4e9e] p-5 sm:p-6 rounded-3xl shadow-xl flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <OrcaMascot mood="cheering" size={82} bubbleText="Bé Orca tính toán sát sạt theo số tiền thật của cậu nhen! 🐳💖" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-amber-300 bg-amber-400/20 px-2.5 py-0.5 rounded-full border border-amber-400/30 font-mono">
                ✨ AI ĐO NI ĐÓNG GIÀY THEO NGỮ CẢNH
              </span>
              <span className="text-xs text-sky-200">· Chuẩn cuộc sống Việt Nam</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
              Hỏi Bé Orca Về Phân Bổ Tiền Bạc
            </h2>
            <p className="text-xs sm:text-sm text-sky-100 mt-1 max-w-xl">
              Không nói chung chung — Bé Orca đọc trực tiếp số liệu sổ sách của cậu để tính toán từng đồng VND, cân đối chi phí cố định, dập nợ và dự phòng an toàn! 🐳
            </p>
          </div>
        </div>

        {/* Live snapshot context toggle & Quick Actions */}
        <div className="bg-[#11234f] border border-[#28468c] p-3 rounded-2xl flex flex-col gap-2 min-w-[240px]">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-300 font-medium flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Gắn sổ kỳ {currentSnapshot.period}
            </span>
            <input
              type="checkbox"
              checked={useCurrentSnapshotContext}
              onChange={(e) => setUseCurrentSnapshotContext(e.target.checked)}
              className="w-4 h-4 rounded text-sky-500 accent-sky-400 cursor-pointer"
            />
          </div>
          {useCurrentSnapshotContext && (
            <div className="text-[11px] text-sky-200 font-mono bg-[#0b1736] p-2 rounded-xl border border-sky-500/20 space-y-0.5">
              <div>Lương net: <strong className="text-white">{formatVND(netIncome)}</strong></div>
              <div>Chi cố định: <strong className={fixedCostRatio > 65 ? 'text-rose-300' : 'text-emerald-300'}>{fixedCostRatio}% lương</strong></div>
              <div>Đệm dự phòng: <strong className={emergencyMonths >= 3 ? 'text-emerald-300' : 'text-amber-300'}>{emergencyMonths} tháng</strong></div>
              {totalDebt > 0 && <div>Tổng nợ: <strong className="text-rose-300">{formatVND(totalDebt)}</strong></div>}
            </div>
          )}
        </div>
      </div>

      {/* LIVING SITUATION & CONTEXT RECOGNITION BAR */}
      <div className="bg-[#132552] border border-[#2b4b96] p-4 rounded-3xl shadow-md space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wide flex items-center gap-1.5 font-mono">
              <Sliders className="w-4 h-4" />
              BỐI CẢNH ĐỜI SỐNG CỦA CẬU ĐANG ÁP DỤNG VÀO CÂU TRẢ LỜI:
            </span>
          </div>

          <button
            onClick={() => setShowContextCustomizer(!showContextCustomizer)}
            className="text-[11px] text-sky-200 hover:text-white flex items-center gap-1 px-3 py-1 bg-[#1a3473] hover:bg-[#224496] rounded-xl border border-sky-400/30 cursor-pointer transition-colors"
          >
            <span>{showContextCustomizer ? 'Ẩn tùy chỉnh bối cảnh ∧' : 'Tùy chỉnh bối cảnh sống ∨'}</span>
          </button>
        </div>

        {/* Live Active Context Badges */}
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="bg-[#183069] border border-sky-400/40 text-sky-100 px-3 py-1 rounded-full flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-sky-300" />
            <span>Khu vực: <strong>{location}</strong></span>
          </span>

          <span className="bg-[#183069] border border-sky-400/40 text-sky-100 px-3 py-1 rounded-full flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-amber-300" />
            <span>Hoàn cảnh: <strong>{lifeStage}</strong></span>
          </span>

          <span className="bg-[#183069] border border-sky-400/40 text-sky-100 px-3 py-1 rounded-full flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-emerald-300" />
            <span>Ưu tiên số 1: <strong>{primaryPriority}</strong></span>
          </span>
        </div>

        {/* Context Customizer Panel */}
        {showContextCustomizer && (
          <div className="pt-3 border-t border-[#233f80] grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <label className="text-slate-300 block mb-1 font-medium">Nơi sinh sống & mức chi phí:</label>
              <select
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-[#0c183a] border border-[#2f519f] text-slate-100 rounded-xl px-2.5 py-1.5 outline-none focus:border-amber-400"
              >
                <option value="Hà Nội / TP.HCM (Mức sống cao)">Hà Nội / TP.HCM (Mức sống cao)</option>
                <option value="Đà Nẵng / Cần Thơ / Hải Phòng (Mức sống vừa)">Đà Nẵng / Cần Thơ (Mức vừa)</option>
                <option value="Các tỉnh thành khác (Mức sống tiết kiệm)">Các tỉnh thành khác (Tiết kiệm)</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 block mb-1 font-medium">Tình trạng cuộc sống:</label>
              <select
                value={lifeStage}
                onChange={(e) => setLifeStage(e.target.value)}
                className="w-full bg-[#0c183a] border border-[#2f519f] text-slate-100 rounded-xl px-2.5 py-1.5 outline-none focus:border-amber-400"
              >
                <option value="Độc thân (Ưu tiên tích lũy)">Độc thân (Ưu tiên tích lũy)</option>
                <option value="Đã có gia đình & con nhỏ">Đã có gia đình & con nhỏ</option>
                <option value="Trụ cột gia đình / Nuôi phụ mẫu">Nuôi phụ mẫu / Trụ cột</option>
              </select>
            </div>

            <div>
              <label className="text-slate-300 block mb-1 font-medium">Mục tiêu tài chính ưu tiên:</label>
              <select
                value={primaryPriority}
                onChange={(e) => setPrimaryPriority(e.target.value)}
                className="w-full bg-[#0c183a] border border-[#2f519f] text-slate-100 rounded-xl px-2.5 py-1.5 outline-none focus:border-amber-400"
              >
                <option value="Cân bằng & Tích lũy tài sản">Cân bằng & Tích lũy tài sản</option>
                <option value="Dập sạch nợ lãi suất cao trước">Dập sạch nợ lãi suất cao trước</option>
                <option value="Xây dựng đệm quỹ khẩn cấp 6 tháng">Xây quỹ khẩn cấp 6 tháng</option>
                <option value="Tích lũy mua xe / mua nhà">Tích lũy mua xe / mua nhà</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Preset Chips Carousel / Grid */}
      <div className="bg-[#12234e] border border-[#28478e] p-4 rounded-3xl shadow-md space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-sky-200 uppercase tracking-wide flex items-center gap-1.5">
            <Lightbulb className="w-4 h-4 text-amber-300" />
            Câu hỏi mẫu chuẩn ngữ cảnh thực tế (Bấm để hỏi ngay):
          </span>
          <button
            onClick={handleResetChat}
            className="text-[11px] text-slate-300 hover:text-white flex items-center gap-1 px-2.5 py-1 bg-[#19326d] hover:bg-[#203f88] rounded-xl border border-sky-400/20 cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3 h-3 text-sky-300" />
            Làm mới hội thoại
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {PRESET_QUESTIONS.map((item, idx) => (
            <button
              key={idx}
              onClick={() => handleSendMessage(item.question)}
              disabled={isLoading}
              className="text-xs text-left bg-[#182f66] hover:bg-[#22428c] text-sky-100 hover:text-white px-3 py-1.5 rounded-2xl border border-sky-400/30 hover:border-sky-300 transition-all cursor-pointer flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-50"
            >
              <span>{item.label}</span>
              <ArrowRight className="w-3 h-3 text-amber-300 shrink-0" />
            </button>
          ))}
        </div>
      </div>

      {/* Chat Messages Box */}
      <div className="bg-[#102047] border border-[#254285] rounded-3xl p-4 sm:p-6 shadow-xl flex flex-col min-h-[480px] max-h-[640px]">
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 sm:pr-2">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 items-start ${
                msg.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              {msg.sender === 'orca' && (
                <div className="shrink-0 mt-0.5">
                  <OrcaMascot mood={msg.mood || 'happy'} size={48} />
                </div>
              )}

              <div
                className={`max-w-[88%] sm:max-w-[82%] rounded-3xl p-4 shadow-md ${
                  msg.sender === 'user'
                    ? 'bg-gradient-to-r from-sky-600 to-blue-600 text-white rounded-tr-xs'
                    : 'bg-[#182e63] border border-[#2f51a3] text-slate-100 rounded-tl-xs'
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-1.5 text-[11px] opacity-80 border-b pb-1 border-white/10 font-mono">
                  <span className="font-bold flex items-center gap-1">
                    {msg.sender === 'user' ? (
                      <>
                        <User className="w-3 h-3" />
                        <span>Cậu nè</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-3 h-3 text-amber-300" />
                        <span className="text-amber-300">Bé Orca thông thái 🐳</span>
                      </>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <span>{msg.timestamp}</span>
                    <button
                      onClick={() => handleCopyText(msg.id, msg.text)}
                      className="hover:text-white p-0.5 rounded cursor-pointer transition-colors"
                      title="Sao chép câu trả lời"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-sans">
                  {msg.text}
                </div>

                {msg.sender === 'orca' && onNavigateToCalculator && (
                  <div className="mt-3 pt-2.5 border-t border-sky-400/20 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-sky-200 text-[11px]">Cậu muốn thử số này ngay không?</span>
                    <button
                      onClick={onNavigateToCalculator}
                      className="text-[11px] font-bold text-amber-300 bg-[#223f85] hover:bg-[#2b4fa4] px-2.5 py-1 rounded-xl border border-amber-400/30 flex items-center gap-1 cursor-pointer transition-all"
                    >
                      <span>⚡ Mở Máy Tính Dòng Tiền</span>
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {msg.sender === 'user' && (
                <div className="w-9 h-9 rounded-full bg-sky-500 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-md">
                  Tôi
                </div>
              )}
            </div>
          ))}

          {/* Loading bubble */}
          {isLoading && (
            <div className="flex gap-3 items-center justify-start">
              <OrcaMascot mood="calculating" size={48} />
              <div className="bg-[#182e63] border border-[#2f51a3] text-sky-200 rounded-3xl rounded-tl-xs p-4 shadow-md text-xs flex items-center gap-3">
                <div className="flex gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-sky-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-sky-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-amber-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span>Bé Orca đang đọc dữ liệu sổ sách và tính toán con số đo ni đóng giày cho cậu nè... 🐳✨</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input box */}
        <div className="mt-4 pt-4 border-t border-[#233d7a]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <div className="flex-1 relative">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Hỏi Bé Orca bất kỳ điều gì: 'Lương thực nhận của mình nên chia thế nào?', 'Mình đang dư 5 triệu/tháng có nên mua xe?'..."
                disabled={isLoading}
                className="w-full bg-[#162a5b] text-white text-xs sm:text-sm px-4 py-3 rounded-2xl border border-[#3053a4] focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30 transition-all placeholder:text-slate-400"
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="px-5 py-3 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-bold text-xs sm:text-sm rounded-2xl shadow-md transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105 active:scale-95 shrink-0"
            >
              <span>Hỏi Bé</span>
              <Send className="w-4 h-4" />
            </button>
          </form>
          <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 px-1">
            <span className="flex items-center gap-1">
              <span>🐳</span>
              <span>Bé Orca gắn chặt dữ liệu thu nhập, chi cố định và nợ vay để cá nhân hóa 100%.</span>
            </span>
            <span className="text-sky-300 font-medium hidden sm:inline">Phản hồi ngữ cảnh với Gemini AI ✨</span>
          </div>
        </div>
      </div>
    </div>
  );
};
