"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type MouseEvent,
} from "react";
import { markAppNavigating } from "@/lib/hooks";
import { clientCacheWarm } from "@/lib/client-cache";
import {
  Bot,
  Boxes,
  CandlestickChart,
  ChartNoAxesCombined,
  ChevronsLeft,
  ChevronsRight,
  Coins,
  DollarSign,
  Eye,
  FlaskConical,
  Globe2,
  Grid2x2,
  Home,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Newspaper,
  Settings,
  X,
} from "lucide-react";
import { TickerTape } from "@/components/ticker-tape";
import { GlobalSearch } from "@/components/search";
import { OrcaWordmark, OrcaMark } from "@/components/logo";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { ErrorBoundary } from "@/components/error-boundary";
import { NotifBell } from "@/components/notif-bell";

export { Shell as default, Shell };

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background-primary text-text-primary">
      <p className="p-4 text-sm text-text-muted">
        Shell loading… If you see this, full shell failed to deploy. Check build logs.
      </p>
      {children}
    </div>
  );
}
