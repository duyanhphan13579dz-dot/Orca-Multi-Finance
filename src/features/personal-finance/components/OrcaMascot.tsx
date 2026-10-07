import React, { useState } from 'react';
import Image from 'next/image';
import beOrcaImg from '../assets/be_orca_transparent.png';
import beOrcaCheeringImg from '../assets/be_orca_cheering_transparent.png';

export type MascotMood = 'happy' | 'calculating' | 'saving' | 'caution' | 'cheering' | 'waving';

interface OrcaMascotProps {
  mood?: MascotMood;
  size?: number;
  className?: string;
  bubbleText?: string;
  showBadgeBackground?: boolean;
  interactive?: boolean;
  onMascotClick?: () => void;
}

const CUTE_QUOTES = [
  'Cậu ơi, tích tiểu thành đại nhen! 🐳✨',
  'Mỗi tháng tiết kiệm một chút là tự do tài chính tới gần nè! 🐷💖',
  'Bé Orca luôn bơi bên cạnh ủng hộ túi tiền của cậu! 🌊',
  'Đừng quên trả cho mình trước khi tiêu nhen! 💵✨',
  'Cậu đang làm rất tốt đó, tự hào ghê! 👑🎉',
];

export const OrcaMascot: React.FC<OrcaMascotProps> = ({
  mood = 'happy',
  size = 76,
  className = '',
  bubbleText,
  showBadgeBackground = false, // Tách nền hoàn toàn, chỉ lấy nhân vật nổi bật
  interactive = true,
  onMascotClick,
}) => {
  const [clickBounce, setClickBounce] = useState(false);
  const [internalQuote, setInternalQuote] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);

  const handleClick = () => {
    setClickBounce(true);
    setTimeout(() => setClickBounce(false), 350);

    if (onMascotClick) {
      onMascotClick();
    } else if (!bubbleText) {
      const randomQuote = CUTE_QUOTES[Math.floor(Math.random() * CUTE_QUOTES.length)];
      setInternalQuote(randomQuote);
      setTimeout(() => setInternalQuote(null), 3500);
    }
  };

  const displayText = bubbleText || internalQuote;
  const imageSrc = mood === 'cheering' ? beOrcaCheeringImg : beOrcaImg;

  return (
    <div className={`inline-flex items-center gap-3 select-none ${className}`}>
      {/* 3D Bé Orca Mascot Tách Nền Trong Suốt Tuyệt Đối */}
      <div
        onClick={handleClick}
        style={{ width: size, height: size }}
        className={`relative shrink-0 flex items-center justify-center transition-all duration-300 ${
          showBadgeBackground
            ? 'rounded-full p-1 bg-gradient-to-tr from-sky-400 via-blue-500 to-indigo-500 shadow-lg ring-2 ring-sky-300/70 hover:ring-amber-400'
            : ''
        } ${interactive ? 'cursor-pointer hover:scale-105 active:scale-95' : ''} ${
          clickBounce ? 'scale-115 rotate-3' : ''
        }`}
        title="Bé Orca ôm ví tiền · Bấm vào bé để nghe lời cổ vũ nhen! 🐳"
      >
        {!imgError ? (
          <Image
            src={imageSrc}
            alt="Bé Orca ôm ví tiền"
            width={size}
            height={size}
            onError={() => setImgError(true)}
            className="w-full h-full object-contain drop-shadow-[0_8px_16px_rgba(0,0,0,0.4)] select-none pointer-events-none"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl">
            🐳
          </div>
        )}

        {/* Biểu tượng trạng thái nhỏ xinh góc dưới */}
        {mood === 'cheering' && (
          <span className="absolute -bottom-1 -right-1 bg-amber-400 text-slate-950 text-[11px] font-bold p-1 rounded-full shadow-md leading-none border border-white">
            👑
          </span>
        )}
        {mood === 'saving' && (
          <span className="absolute -bottom-1 -right-1 bg-rose-400 text-white text-[11px] font-bold p-1 rounded-full shadow-md leading-none border border-white">
            🐷
          </span>
        )}
        {mood === 'calculating' && (
          <span className="absolute -bottom-1 -right-1 bg-amber-400 text-slate-950 text-[11px] font-bold p-1 rounded-full shadow-md leading-none border border-white">
            💰
          </span>
        )}
      </div>

      {/* Khung thoại Bé Orca siêu dễ thương, chữ to rõ */}
      {displayText && (
        <div className="relative bg-white text-slate-900 text-xs px-4 py-2.5 rounded-2xl shadow-xl border-2 border-sky-300 max-w-sm sm:max-w-md animate-in fade-in duration-200">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-sky-600 mb-0.5 tracking-wide uppercase font-mono">
            <span>🐳 Bé Orca:</span>
          </div>
          <div className="font-semibold text-slate-800 leading-relaxed text-xs">
            {displayText}
          </div>
          {/* Mũi tên trỏ vào bé */}
          <div className="absolute top-1/2 -left-2 -translate-y-1/2 w-0 h-0 border-t-[5px] border-t-transparent border-r-[8px] border-r-white border-b-[5px] border-b-transparent"></div>
        </div>
      )}
    </div>
  );
};
