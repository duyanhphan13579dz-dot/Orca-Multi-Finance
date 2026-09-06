import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { SettingsProvider } from "@/lib/settings";

export const metadata: Metadata = {
  title: {
    default: "ORCA Financial — Intelligent Investment Platform",
    template: "%s | ORCA Financial",
  },
  description:
    "Real-time, event-driven, multi-asset financial intelligence platform — VN stocks (VNDirect), crypto (Binance), forex (Biquote), commodities (VietnamBiz Data — WiFeed), news, reports and an AI research agent.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#060d1d",
  width: "device-width",
  initialScale: 1,
};

/** Apply persisted theme before first paint (no flash). */
const themeInit = `(function(){try{var raw=localStorage.getItem('orca.settings.v1');var s=raw?JSON.parse(raw):null;var m=(s&&s.appearance&&s.appearance.mode)||'navy';var r=m==='system'?(matchMedia('(prefers-color-scheme: light)').matches?'light':'navy'):m;document.documentElement.dataset.theme=r;document.documentElement.dataset.density=(s&&s.appearance&&s.appearance.density)||'normal';document.documentElement.dataset.lowdata=String(!!(s&&s.realtime&&s.realtime.lowDataMode));var fs={sm:'14px',md:'15px',lg:'16px'}[(s&&s.appearance&&s.appearance.fontSize)||'md'];document.documentElement.style.setProperty('--app-font',fs);}catch(e){document.documentElement.dataset.theme='navy';}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="navy" suppressHydrationWarning>
      <body className="min-h-dvh">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <SettingsProvider>
          <AppShell>{children}</AppShell>
        </SettingsProvider>
      </body>
    </html>
  );
}
