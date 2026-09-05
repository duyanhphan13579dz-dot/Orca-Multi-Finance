"use client";

import { useState } from "react";
import { useApi } from "@/lib/hooks";
import type { NewsArticle } from "@/lib/types";
import { Badge, FreshnessDot, Loading, MetaLine, Panel, Unavailable } from "@/components/ui";
import { Newspaper } from "lucide-react";

const TABS: { key: string; label: string }[] = [
  { key: "", label: "Tất cả" },
  { key: "market", label: "Thị trường" },
  { key: "corporate", label: "Doanh nghiệp" },
  { key: "macro", label: "Vĩ mô" },
  { key: "crypto", label: "Crypto" },
];

type NewsData = { articles: NewsArticle[]; errors: string[] };

export default function NewsPage() {
  const [tab, setTab] = useState("");
  const { data, meta, isLoading } = useApi<NewsData>(`/api/v1/news?limit=50${tab ? `&category=${tab}` : ""}`, { refreshInterval: 2 * 60_000 });

  return (
    <div className="space-y-3">
      <Panel pad={false}>
        <div className="flex flex-col gap-2 p-4">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Newspaper className="size-5 text-accent" /> Luồng tin tức thờ gian thực
            {meta && <FreshnessDot status={meta.freshness} ageMs={meta.ageMs} />}
          </h1>
          <p className="text-[12px] text-ink-3">
            Tổng hợp RSS đa nguồn thật — CafeF, VnExpress, VietnamBiz, CoinTelegraph — có kiểm chứng thờ gian, loại trùng và gắn nhãn mã/ngành tự động.
          </p>
          <div className="mt-1 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-md px-2.5 py-1 text-[12px] ${tab === t.key ? "bg-accent/15 text-accent" : "text-ink-3 hover:text-ink"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <MetaLine meta={meta} />
        </div>
      </Panel>

      {isLoading && !data ? (
        <Loading rows={10} />
      ) : !data ? (
        <Unavailable title="Tất cả nguồn tin đều đang lỗi" meta={meta} />
      ) : (
        <Panel pad={false}>
          <ul className="divide-y divide-line/50">
            {data.articles.map((a) => (
              <li key={a.id} className="row-hover px-3.5 py-3">
                <div className="flex items-start gap-3">
                  <div className="num mt-0.5 w-14 shrink-0 text-[11px] text-ink-3">
                    {new Date(a.publishedAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit" })}
                    <div className="text-[9px]">{new Date(a.publishedAt).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" })}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-[13.5px] font-medium leading-snug text-ink hover:text-accent">
                      {a.title}
                    </a>
                    {a.summary && <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-3">{a.summary}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge>{a.source}</Badge>
                      {a.relatedSector && <Badge tone="accent">{a.relatedSector}</Badge>}
                      {a.relatedSymbols.map((s) => (
                        <Badge key={s}>{s.replace(/USDT$/, "")}</Badge>
                      ))}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {data.errors.length > 0 && (
            <div className="border-t border-line px-3.5 py-2 text-[11px] text-warn/90">
              {data.errors.length} nguồn tạm lỗi — nội dung trên là phần thu thập được.
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
