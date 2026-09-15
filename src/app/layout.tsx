import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { ClientProviders } from "@/components/client-providers";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="navy" suppressHydrationWarning className="h-full">
      <body className="h-full overflow-hidden">
        <SettingsProvider>
          <ClientProviders>
            <AppShell>{children}</AppShell>
          </ClientProviders>
        </SettingsProvider>
      </body>
    </html>
  );
}
