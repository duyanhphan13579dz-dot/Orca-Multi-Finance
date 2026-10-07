import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./stock-ui.css";
import "./stock-ui-extra.css";
import "./chart-ui.css";
import "./motion.css";
import { AppShell } from "@/components/shell";
import { ClientProviders } from "@/components/client-providers";
import { SettingsProvider } from "@/lib/settings";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL?.startsWith("http")
      ? process.env.NEXT_PUBLIC_SITE_URL
      : "https://orcamulti.vercel.app",
  ),
  title: {
    default: "ORCA Financial — Nền tảng đầu tư thông minh",
    template: "%s | ORCA Financial",
  },
  description:
    "Nền tảng phân tích tài chính thời gian thực — Cổ phiếu Việt Nam, tiền mã hóa, ngoại hối, hàng hóa, tin tức, báo cáo và trợ lý AI nghiên cứu.",
  applicationName: "ORCA Financial",
  icons: {
    icon: [
      { url: "/icon", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon", type: "image/png" }],
    shortcut: ["/icon"],
  },
  manifest: "/site.webmanifest",
  openGraph: {
    type: "website",
    locale: "vi_VN",
    siteName: "ORCA Financial",
    title: "ORCA Financial — Nền tảng đầu tư thông minh",
    description:
      "Phân tích tài chính realtime: cổ phiếu VN, crypto, forex, hàng hóa, tin tức và AI nghiên cứu.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ORCA Financial",
    description: "Nền tảng đầu tư thông minh — realtime & AI.",
  },
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
