import { CryptoMarketPage } from "@/components/crypto-market";
import { AuthGate } from "@/components/auth-gate";

export const metadata = { title: "Crypto — Binance realtime" };

export default function CryptoPage() {
  return (
    <AuthGate feature="Crypto" description="Thị trường Crypto realtime từ Binance — cần đăng nhập để xem bảng giá, scalp panel và cảnh báoFunding/OI.">
      <CryptoMarketPage />
    </AuthGate>
  );
}
