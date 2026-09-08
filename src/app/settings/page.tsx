import { Suspense } from "react";
import { SettingsPage } from "@/components/settings-page";
import { AuthGate } from "@/components/auth-gate";

export const metadata = { title: "Cài đặt" };

export default function Page() {
  return (
    <AuthGate feature="Cài đặt" description="Tùy chỉnh giao diện, múi giờ, thông báo & đồng bộ preferences — cần đăng nhập để lưu và đồng bộ đa thiết bị.">
      <Suspense>
        <SettingsPage />
      </Suspense>
    </AuthGate>
  );
}
