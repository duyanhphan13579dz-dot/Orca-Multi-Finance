"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { startTransition, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { markAppNavigating } from "@/lib/hooks";
import {
  Bell, Bot, Boxes, CandlestickChart, ChartNoAxesCombined, ChevronsLeft, ChevronsRight, Coins, DollarSign,
  Eye, FlaskConical, GaugeCircle, Globe2, Grid2x2, Home, Landmark, LogOut, Menu, Newspaper, NotebookPen, Settings, X,
} from "lucide-react";
import { TickerTape } from "@/components/ticker-tape";
import { GlobalSearch } from "@/components/search";
import { OrcaWordmark, OrcaMark } from "@/components/logo";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { FreshnessDot } from "@/components/ui";
import type { NewsArticle } from "@/lib/types";

// TEMP - full content will follow in next push if this works
export function AppShell({ children }: { children: ReactNode }) {
  return <div className="h-full">{children}</div>;
}
