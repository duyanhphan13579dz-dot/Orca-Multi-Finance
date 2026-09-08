import { CryptoDetailPage } from "@/components/crypto-detail";
import { AuthGate } from "@/components/auth-gate";

export const metadata = { title: "Crypto detail" };

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return (
    <AuthGate feature="Crypto" description="Chi tiết Crypto realtime — cần đăng nhập để xem.">
      <CryptoDetailPage symbol={symbol.toUpperCase()} />
    </AuthGate>
  );
}
