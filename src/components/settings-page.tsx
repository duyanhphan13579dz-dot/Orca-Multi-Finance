"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell, Bot, Database, LayoutDashboard, Monitor, ShieldCheck, SlidersHorizontal, User2,
} from "lucide-react";
import { useSettings, DASHBOARD_WIDGETS, type UserSettings } from "@/lib/settings";
import { Badge, Panel } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import type { ProviderStatus } from "@/lib/types";
import { ProfileTab, AppearanceTab } from "@/components/settings-panels-extra";
import { SecurityTab, SystemTab, DataRealtimeTab, AiTab, DashboardTab, NotificationsTab } from "@/components/settings-panels";

const TABS = [
  { id: "profile", label: "Profile", icon: User2 },
  { id: "appearance", label: "Appearance", icon: Monitor },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "realtime", label: "Data & Realtime", icon: Database },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "ai", label: "AI Settings", icon: Bot },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "system", label: "System", icon: SlidersHorizontal },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function SettingsPage() {
  const params = useSearchParams();
  const initial = (params.get("tab") as TabId) || "profile";
  const [tab, setTab] = useState<TabId>(TABS.some((t) => t.id === initial) ? initial : "profile");

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-lg font-semibold">Cài đặt</h1>
      <p className="mb-4 text-[12px] text-text-muted">
        Mọi thay đổi được lưu tức thờ (local) và đồng bộ tài khoản khi đã đăng nhập — không bao giờ reset khi refresh.
      </p>
      <div className="grid grid-cols-12 gap-3">
        <Panel className="col-span-12 md:col-span-3" pad={false}>
          <nav className="flex gap-0.5 overflow-x-auto p-1.5 md:flex-col" aria-label="Settings tabs">
            {TABS.map((t) => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  aria-current={tab === t.id ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[12.5px] transition-colors ${
                    tab === t.id ? "bg-accent-primary/12 text-accent-primary" : "text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
                  }`}
                >
                  <Icon className="size-4 shrink-0" />
                  {t.label}
                </button>
              );
            })}
          </nav>
        </Panel>
        <div className="col-span-12 min-w-0 md:col-span-9">
          {tab === "profile" && <ProfileTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "dashboard" && <DashboardTab />}
          {tab === "realtime" && <DataRealtimeTab />}
          {tab === "notifications" && <NotificationsTab />}
          {tab === "ai" && <AiTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "system" && <SystemTab />}
        </div>
      </div>
    </div>
  );
}

export { TABS as SETTINGS_TABS };
export type { UserSettings, ProviderStatus };
export { Badge, Panel, useApi, useSettings, DASHBOARD_WIDGETS, Link, useEffect, useState };
