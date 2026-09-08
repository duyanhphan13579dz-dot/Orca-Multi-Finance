import { ForexDashboard } from "@/components/forex-dashboard";
import { AuthGate } from "@/components/auth-gate";

export const metadata = { title: "Forex" };

export default function Page() {
  return (
    <AuthGate feature="Forex" description="Thị trường Forex realtime từ Biquote — cần đăng nhập để xem bảng giá và phân tích kỹ thuật.">
      <ForexDashboard />
    </AuthGate>
  );
}
