"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import CommodityDetailView from "@/components/commodity-detail";
import { ArrowLeft } from "lucide-react";

/**
 * COMMODITY LANDING PAGE (route) — /commodities/:key
 * Chi tiết một hàng hóa khi người dùng chọn nó; cùng visual identity với
 * trang tổng quan. Toàn bộ nội dung nằm trong <CommodityDetailView/> (dùng
 * chung với floating overlay trên /commodities), nên dữ liệu hiển thị đồng
 * nhất giữa hai lối vào.
 */
export default function CommodityLandingPage() {
  const params = useParams<{ key: string }>();
  const key = params.key.toUpperCase();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/commodities" className="inline-flex items-center gap-1.5 text-[12px] text-text-muted hover:text-text-primary">
          <ArrowLeft className="size-3.5" /> Hàng hóa
        </Link>
        <span className="text-[11px] text-text-muted">/</span>
        <span className="text-[12px] text-text-secondary">{key}</span>
      </div>
      <CommodityDetailView symbol={key} />
    </div>
  );
}
