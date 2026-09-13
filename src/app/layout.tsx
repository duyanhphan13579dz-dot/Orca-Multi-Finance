import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { SettingsProvider } from "@/lib/settings";

export const metadata: Metadata = {
  title: {
    default: "ORCA Financial — Nền tảng đầu tư thông minh",
    template: "%s | ORCA Financial",
  },
  description:
    "Nền tảng phân tích tài chính thời gian thực — Cổ phiếu Việt Nam, tiền mã hóa, ngoại hối, hàng hóa, tin tức, báo cáo và trợ lý AI nghiên cứu.",
  icons: { icon: "/icon.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ORCA Financial",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#060d1d" },
    { media: "(prefers-color-scheme: light)", color: "#eef2f9" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Apply persisted theme before first paint (no flash). */
const themeInit = `(function(){try{var raw=localStorage.getItem('orca.settings.v1');var s=raw?JSON.parse(raw):null;var m=(s&&s.appearance&&s.appearance.mode)||'navy';var r=m==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'navy'):m;document.documentElement.dataset.theme=r;document.documentElement.dataset.density=(s&&s.appearance&&s.appearance.density)||'normal';document.documentElement.dataset.lowdata=String(!!(s&&s.realtime&&s.realtime.lowDataMode));var fs={sm:'14px',md:'15px',lg:'16px'}[(s&&s.appearance&&s.appearance.fontSize)||'md'];document.documentElement.style.setProperty('--app-font',fs);}catch(e){document.documentElement.dataset.theme='navy';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="navy" suppressHydrationWarning className="h-full">
      <body className="h-full overflow-hidden">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <SettingsProvider>
          <AppShell>{children}</AppShell>
        </SettingsProvider>
      </body>
    </html>
  );
}
