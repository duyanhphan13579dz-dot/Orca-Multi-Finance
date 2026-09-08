import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/shell";
import { SettingsProvider } from "@/lib/settings";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppSWRProvider } from "@/components/swr-provider";

export const metadata: Metadata = {
  title: {
    default: "ORCA Financial — Intelligent Investment Platform",
    template: "%s | ORCA Financial",
  },
  description:
    "Real-time, event-driven, multi-asset financial intelligence platform — VN stocks (VNStock), crypto (Binance), forex (Biquote), commodities (Vietnambiz/Simplize), news, reports and an AI research agent.",
  icons: { icon: "/icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#060d1d",
  width: "device-width",
  initialScale: 1,
};

/** Apply persisted theme before first paint (no flash). — hardened: corrupted JSON never crashes */
const themeInit = `(function(){try{var raw=localStorage.getItem('orca.settings.v1');var s=null;try{s=raw?JSON.parse(raw):null}catch(e){s=null}var m=(s&&s.appearance&&s.appearance.mode)||'navy';if(m!=='navy'&&m!=='light'&&m!=='system')m='navy';var r=m==='system'?(typeof matchMedia!=='undefined'&&matchMedia('(prefers-color-scheme: light)').matches?'light':'navy'):m;document.documentElement.dataset.theme=r;var d=(s&&s.appearance&&s.appearance.density)||'normal';if(d!=='compact'&&d!=='comfortable'&&d!=='normal')d='normal';document.documentElement.dataset.density=d;var ld=!!(s&&s.realtime&&s.realtime.lowDataMode);document.documentElement.dataset.lowdata=String(ld);var fsMap={sm:'14px',md:'15px',lg:'16px'};var fsKey=(s&&s.appearance&&s.appearance.fontSize)||'md';if(!fsMap[fsKey])fsKey='md';document.documentElement.style.setProperty('--app-font',fsMap[fsKey]);}catch(e){try{document.documentElement.dataset.theme='navy';}catch(e2){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" data-theme="navy" suppressHydrationWarning>
      <body className="min-h-dvh">
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
        <ErrorBoundary>
          <AppSWRProvider>
            <SettingsProvider>
              <AppShell>{children}</AppShell>
            </SettingsProvider>
          </AppSWRProvider>
        </ErrorBoundary>
        {/* Global window error guard — auto-recovery for stale chunks / React #310 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{window.addEventListener('unhandledrejection',function(e){try{var m=(e.reason&&e.reason.message)||'';console.warn('[orca] unhandledrejection',m);if(/ChunkLoadError|Loading chunk|Minified React error #310|Rendered more hooks/i.test(m)){var k='orca.chunkReload';var last=sessionStorage.getItem(k);var now=Date.now();if(!last||now-parseInt(last,10)>30000){sessionStorage.setItem(k,String(now));setTimeout(function(){try{var u=new URL(location.href);u.searchParams.set('_r',String(now));location.replace(u.toString());}catch{location.reload();}},900);}}}catch{}});window.addEventListener('error',function(e){try{var m=e.message||'';if(/ChunkLoadError|Loading chunk|Minified React error #310|Rendered more hooks/i.test(m)){console.warn('[orca] chunk error',m);var k='orca.chunkReload';var last=sessionStorage.getItem(k);var now=Date.now();if(!last||now-parseInt(last,10)>30000){sessionStorage.setItem(k,String(now));setTimeout(function(){try{var u=new URL(location.href);u.searchParams.set('_r',String(now));location.replace(u.toString());}catch{location.reload();}},900);}}}catch{}});}catch(e){}})();`,
          }}
        />
      </body>
    </html>
  );
}
