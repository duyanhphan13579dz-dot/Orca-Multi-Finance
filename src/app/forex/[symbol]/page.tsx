import { ForexDetailPage } from "@/components/forex-detail";
import { AuthGate } from "@/components/auth-gate";

export const metadata = { title: "Forex detail" };

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return (
    <AuthGate feature="Forex" description="Chi tiết Forex realtime — cần đăng nhập để xem.">
      <ForexDetailPage pair={symbol.toUpperCase().replace(/[^A-Z]/g, "")} />
    </AuthGate>
  );
}
