"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  Bot,
  Database,
  LayoutDashboard,
  Monitor,
  ShieldCheck,
  SlidersHorizontal,
  User2,
  Wallet,
  Save,
} from "lucide-react";
import { useSettings, DASHBOARD_WIDGETS, type UserSettings } from "@/lib/settings";
import { Badge, Panel } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import type { ProviderStatus } from "@/lib/types";
import { ProfileTab, AppearanceTab } from "@/components/settings-panels-extra";
import {
  SecurityTab,
  SystemTab,
  DataRealtimeTab,
  AiTab,
  DashboardTab,
  NotificationsTab,
  TradingTab,
  DataManagementTab,
} from "@/components/settings-panels";
import { SheetsSyncPanel } from "@/components/sheets-sync-panel";

const TABS = [
  { id: "profile", label: "Hồ sơ", icon: User2 },
  { id: "appearance", label: "Giao diện", icon: Monitor },
  { id: "dashboard", label: "Bảng điều khiển", icon: LayoutDashboard },
  { id: "trading", label: "Giao dịch & Phí", icon: Wallet },
  { id: "realtime", label: "Dữ liệu realtime", icon: Database },
  { id: "notifications", label: "Thông báo", icon: Bell },
  { id: "ai", label: "Cài đặt AI", icon: Bot },
  { id: "security", label: "Bảo mật", icon: ShieldCheck },
  { id: "data", label: "Quản lý dữ liệu", icon: Save },
  { id: "system", label: "Hệ thống", icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (params.get("tab") as TabId) || "profile";
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? initial : "profile");

  useEffect(() => {
    const q = params.get("tab") as TabId | null;
    if (q && TABS.some((t) => t.id === q) && q !== tab) setTab(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const selectTab = (id: TabId) => {
    setTab(id);
    router.replace(`/settings?tab=${id}`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-4">
        <h1 className="text-lg font-semibold text-text-primary">Cài đặt</h1>
        <p className="mt-0.5 text-[12px] text-text-muted">
          Thay đổi lưu ngay trên thiết bị; đăng nhập để đồng bộ giữa các máy. Google Sheets nằm
          trong tab Dữ liệu realtime.
        </p>
      </header>

      <div className="grid grid-cols-12 gap-3">
        <Panel className="col-span-12 md:col-span-3" pad={false}>
          <nav className="flex gap-0.5 overflow-x-auto p-1.5 md:flex-col" aria-label="Mục cài đặt">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                    tab === t.id
                      ? "bg-accent-primary/12 font-medium text-accent-primary"
                      : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </Panel>

        <div className="col-span-12 min-w-0 space-y-3 md:col-span-9">
          {tab === "profile" && <ProfileTab onOpenSecurity={() => selectTab("security")} />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "dashboard" && <DashboardTab />}
          {tab === "trading" && <TradingTab />}
          {tab === "realtime" && (
            <>
              <DataRealtimeTab />
              <SheetsSyncPanel />
            </>
          )}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "ai" && <AiTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "data" && <DataManagementTab />}
          {tab === "system" && <SystemTab />}
        </div>
      </div>
    </div>
  );
}

export { TABS as SETTINGS_TABS };
export type { UserSettings, ProviderStatus };
export { Badge, Panel, useApi, useSettings, DASHBOARD_WIDGETS, Link, useEffect, useState };
