"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { loadAlerts } from "@/lib/alerts-store";
import type { NewsArticle } from "@/lib/types";

type ReportItem = {
  id: string;
  type: string;
  title: string;
  generatedAt: string;
};

function vnMinutesNow(): number {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Ho_Chi_Minh",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
    return h * 60 + m;
  } catch {
    return new Date().getHours() * 60 + new Date().getMinutes();
  }
}

function vnDateKey(): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function seenReportIds(): Set<string> {
  try {
    const raw = localStorage.getItem("orca.reports.seen.ids") ?? "[]";
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function markReportsSeen(ids: string[]) {
  try {
    const set = seenReportIds();
    for (const id of ids) set.add(id);
    const arr = [...set].slice(-40);
    localStorage.setItem("orca.reports.seen.ids", JSON.stringify(arr));
  } catch {
    /* */
  }
}

const TYPE_LABEL: Record<string, string> = {
  morning_brief: "Morning Brief",
  intraday_brief: "Intraday Brief",
  market_summary: "Market Summary",
  strategy: "Weekly Strategy",
};

export function NotifBell() {
  const { settings } = useSettings();
  const n = settings.notifications;
  const { data } = useApi<{ articles: NewsArticle[] }>(
    n.marketNews ? "/api/v1/news?limit=8" : null,
    { refreshInterval: 90_000 },
  );
  const { data: reportData, mutate: mutateReports } = useApi<{ items: ReportItem[] }>(
    n.reportReady || n.digestMorning ? "/api/v1/reports?limit=7" : null,
    { refreshInterval: 120_000 },
  );
  const [open, setOpen] = useState(false);
  const [alertTick, setAlertTick] = useState(0);
  const [reportTick, setReportTick] = useState(0);
  const notifiedRef = useRef<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: Event) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!n.priceAlerts) return;
    const bump = () => setAlertTick((t) => t + 1);
    window.addEventListener("orca-alerts-changed", bump as EventListener);
    const t = window.setInterval(bump, 20_000);
    return () => {
      window.removeEventListener("orca-alerts-changed", bump as EventListener);
      window.clearInterval(t);
    };
  }, [n.priceAlerts]);

  const articles = data?.articles ?? [];
  const now = Date.now();
  const freshNews = n.marketNews
    ? articles.filter((a) => {
        const t = Date.parse(a.publishedAt);
        return Number.isFinite(t) && now - t < 30 * 60_000;
      })
    : [];

  void alertTick;
  void reportTick;

  const triggeredAlerts =
    n.priceAlerts && typeof window !== "undefined"
      ? loadAlerts()
          .filter((a) => a.status === "triggered")
          .slice(0, 6)
          .map((a) => ({
            id: a.id,
            symbol: a.symbol,
            price: a.triggeredPrice,
            at: a.triggeredAt,
          }))
      : [];

  const reportItems = (reportData?.items ?? []).filter((r) =>
    ["morning_brief", "intraday_brief", "market_summary"].includes(r.type),
  );

  const recentReports = reportItems
    .filter((r) => {
      const t = Date.parse(r.generatedAt);
      return Number.isFinite(t) && now - t < 18 * 60 * 60_000;
    })
    .slice(0, 5);

  const seen = typeof window !== "undefined" ? seenReportIds() : new Set<string>();
  const unreadReports = n.reportReady ? recentReports.filter((r) => !seen.has(r.id)) : [];

  useEffect(() => {
    if (!n.reportReady || typeof window === "undefined") return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    for (const r of unreadReports) {
      if (notifiedRef.current.has(r.id)) continue;
      notifiedRef.current.add(r.id);
      try {
        new Notification(`ORCA · ${TYPE_LABEL[r.type] ?? "Bản tin"} sẵn sàng`, {
          body: r.title,
          tag: `orca-report-${r.id}`,
        });
      } catch {
        /* */
      }
    }
  }, [unreadReports, n.reportReady]);

  const mins = vnMinutesNow();
  const inMorningWindow = mins >= 7 * 60 && mins < 10 * 60;
  const digestKey = "orca.digest.seen." + vnDateKey();
  let digestSeen = false;
  if (typeof window !== "undefined") {
    try {
      digestSeen = localStorage.getItem(digestKey) === "1";
    } catch {
      /* */
    }
  }
  const showDigest = n.digestMorning && inMorningWindow && !digestSeen;

  const badgeCount =
    (freshNews.length > 0 ? 1 : 0) +
    (triggeredAlerts.length > 0 ? 1 : 0) +
    (showDigest ? 1 : 0) +
    (unreadReports.length > 0 ? unreadReports.length : 0);

  const markDigest = () => {
    try {
      localStorage.setItem(digestKey, "1");
      setReportTick((t) => t + 1);
    } catch {
      /* */
    }
  };

  const markAllReports = () => {
    markReportsSeen(recentReports.map((r) => r.id));
    setReportTick((t) => t + 1);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void mutateReports?.();
        }}
        className="relative grid size-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
        aria-label="Thông báo"
      >
        <Bell className="size-4" />
        {badgeCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 min-w-[14px] rounded-full bg-accent-primary px-1 text-center text-[9px] font-bold leading-[14px] text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 z-50 mt-1.5 w-[min(100vw-1.5rem,320px)] overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="text-[12px] font-semibold text-text-primary">Thông báo</span>
            {unreadReports.length ? (
              <button
                type="button"
                onClick={markAllReports}
                className="text-[10.5px] text-accent-primary hover:underline"
              >
                Đánh dấu đã đọc
              </button>
            ) : null}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {unreadReports.length || recentReports.length ? (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Bản tin tự động
                </div>
                <ul>
                  {(unreadReports.length ? unreadReports : recentReports).map((r) => {
                    const unread = !seen.has(r.id);
                    return (
                      <li key={r.id}>
                        <Link
                          href="/reports"
                          onClick={() => {
                            markReportsSeen([r.id]);
                            setOpen(false);
                            setReportTick((t) => t + 1);
                          }}
                          className="block border-b border-border-subtle px-3 py-2.5 hover:bg-surface-elevated"
                        >
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-accent-primary">
                            {unread ? "• " : ""}
                            {TYPE_LABEL[r.type] ?? r.type}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[12.5px] font-medium text-text-primary">
                            {r.title}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-text-muted">
                            {new Date(r.generatedAt).toLocaleString("vi-VN", {
                              timeZone: "Asia/Ho_Chi_Minh",
                            })}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}

            {showDigest ? (
              <div className="border-b border-border-subtle px-3 py-2.5">
                <div className="text-[12px] font-medium text-text-primary">Digest buổi sáng</div>
                <p className="mt-0.5 text-[11px] text-text-muted">
                  Morning Brief trong khung 07:00–10:00 — mở Bản tin để đọc.
                </p>
                <div className="mt-1.5 flex gap-2">
                  <Link
                    href="/reports"
                    onClick={() => {
                      markDigest();
                      setOpen(false);
                    }}
                    className="text-[11px] text-accent-primary hover:underline"
                  >
                    Xem bản tin
                  </Link>
                  <button type="button" onClick={markDigest} className="text-[11px] text-text-muted hover:underline">
                    Bỏ qua
                  </button>
                </div>
              </div>
            ) : null}

            {triggeredAlerts.length ? (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Cảnh báo giá
                </div>
                <ul>
                  {triggeredAlerts.map((a) => (
                    <li key={a.id}>
                      <Link
                        href="/portfolio"
                        onClick={() => setOpen(false)}
                        className="block border-b border-border-subtle px-3 py-2 hover:bg-surface-elevated"
                      >
                        <span className="font-semibold text-accent-primary">{a.symbol}</span>
                        <span className="ml-2 num text-[12px] text-text-secondary">
                          {a.price != null ? a.price.toLocaleString("vi-VN") : "—"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {n.marketNews ? (
              <div>
                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Tin thị trường
                </div>
                {articles.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[12px] text-text-muted">Chưa có tin</div>
                ) : (
                  <ul>
                    {articles.slice(0, 8).map((a) => {
                      const isFresh = freshNews.some((f) => f.id === a.id || f.url === a.url);
                      return (
                        <li key={a.id || a.url}>
                          <a
                            href={a.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => setOpen(false)}
                            className="block border-b border-border-subtle px-3 py-2.5 text-left hover:bg-surface-elevated"
                          >
                            <span className="line-clamp-2 text-[12.5px] font-medium text-text-primary">
                              {isFresh ? "• " : ""}
                              {a.title}
                            </span>
                            <span className="mt-0.5 block text-[10px] text-text-muted">{a.source}</span>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}

            {!unreadReports.length &&
            !recentReports.length &&
            !showDigest &&
            !triggeredAlerts.length &&
            !articles.length ? (
              <div className="px-3 py-6 text-center text-[12px] text-text-muted">Chưa có thông báo mới</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
