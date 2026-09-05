import { Suspense } from "react";
import { SettingsPage } from "@/components/settings-page";

export const metadata = { title: "Cài đặt" };

export default function Page() {
  return (
    <Suspense>
      <SettingsPage />
    </Suspense>
  );
}
