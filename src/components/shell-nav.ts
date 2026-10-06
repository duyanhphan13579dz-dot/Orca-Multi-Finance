"use client";

import type { ComponentType } from "react";
import {
  Bot,
  Boxes,
  CandlestickChart,
  ChartNoAxesCombined,
  ClipboardList,
  Coins,
  DollarSign,
  Eye,
  FileText,
  FlaskConical,
  Globe2,
  Grid2x2,
  Home,
  Landmark,
  LayoutDashboard,
  Lightbulb,
  LineChart,
  Newspaper,
  Settings,
  Shield,
  Target,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  core?: boolean;
};

export type NavSection = { title: string; items: NavItem[] };

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "THỊ TRƯỜNG",
    items: [
      { href: "/", label: "Tổng quan", icon: Home, core: true },
      { href: "/stocks", label: "Cổ phiếu VN", icon: CandlestickChart, core: true },
      { href: "/crypto", label: "Tiền mã hóa", icon: Coins, core: true },
      { href: "/forex", label: "Ngoại hối", icon: DollarSign },
      { href: "/commodities", label: "Hàng hóa", icon: Boxes },
      { href: "/derivatives", label: "Phái sinh", icon: CandlestickChart, core: true },
      { href: "/macro-economic", label: "Kinh tế vĩ mô", icon: ChartNoAxesCombined },
      { href: "/currency-interest-rate", label: "Lãi suất tiền tệ", icon: Landmark },
    ],
  },
  {
    title: "CÔNG CỤ",
    items: [
      { href: "/heatmap", label: "Bản đồ nhiệt", icon: Grid2x2 },
      { href: "/screener", label: "Bộ lọc", icon: FlaskConical },
      { href: "/news", label: "Tin tức", icon: Newspaper, core: true },
      { href: "/reports", label: "Bản tin", icon: Globe2 },
      { href: "/agent", label: "Trợ lý AI", icon: Bot },
    ],
  },
  {
    title: "DANH MỤC",
    items: [
      { href: "/portfolio", label: "Danh mục thông minh", icon: LayoutDashboard },
      { href: "/watchlist", label: "Danh mục theo dõi", icon: Eye },
      { href: "/settings", label: "Cài đặt", icon: Settings },
    ],
  },
];

export const NAV_SECTIONS_PF: NavSection[] = [
  {
    title: "TÀI CHÍNH CÁ NHÂN",
    items: [
      { href: "/pf", label: "Tổng quan", icon: Home, core: true },
      { href: "/pf/checkin", label: "Check-in tháng", icon: ClipboardList, core: true },
      { href: "/pf/analytics", label: "Phân tích", icon: LineChart, core: true },
      { href: "/pf/planning", label: "Kế hoạch", icon: Target },
      { href: "/pf/advice", label: "Lời khuyên", icon: Lightbulb },
      { href: "/pf/report", label: "Báo cáo", icon: FileText },
    ],
  },
  {
    title: "HỆ THỐNG",
    items: [
      { href: "/pf/privacy", label: "Riêng tư & dữ liệu", icon: Shield },
      { href: "/settings", label: "Cài đặt", icon: Settings, core: true },
    ],
  },
];
