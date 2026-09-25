"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useApi } from "@/lib/hooks";
import { useSettings } from "@/lib/settings";
import { loadAlerts } from "@/lib/alerts-store";
import type { NewsArticle } from "@/lib/types";

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

export function NotifBell() {
  const { settings } = useSettings();
  const n = settings.notifications;
  const { data } = useApi<{ articles: NewsArticle[] }>(
    n.marketNews ? "/api/v1/news?limit=8" : null,
    { refreshInterval: 90_000 },
  );
  const [open, setOpen] = useState(false);
  const [alertTick, setAlertTick] = useState(0);
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

  const mins = vnMinutesNow();
  const inMorningWindow = mins >= 7 * 60 && mins < 10 * 60;
  const digestKey = "orca.digest.seen." + vnDateKey();
  const reportKey = "orca.report.seen." + vnDateKey();
  let digestSeen = false;
  let reportSeen = false;
  if (typeof window !== "undefined") {
    try {
      digestSeen = localStorage.getItem(digestKey) === "1";
      reportSeen = localStorage.getItem(reportKey) === "1";
    } catch {
      /* ignore */
    }
  }
  const showDigest = n.digestMorning && inMorningWindow && !digestSeen;
  const showReport =
    n.reportReady && !reportSeen && (inMorningWindow || (mins >= 15 * 60 && mins < 17 * 60));

  const badgeCount =
    (freshNews.length > 0 ? 1 : 0) +
    (triggeredAlerts.length > 0 ? 1 : 0) +
    (showDigest ? 1 : 0) +
    (showReport ? 1 : 0);

  const markDigest = () => {
    try {
      localStorage.setItem(digestKey, "1");
    } catch {
      /* ignore */
    }
    setAlertTick((t) => t + 1);
  };
  const markReport = () => {
    try {
      localStorage.setItem(reportKey, "1");
    } catch {
      /* ignore */
    }
    setAlertTick((t) => t + 1);
  };

  const anyEnabled = n.marketNews || n.priceAlerts || n.reportReady || n.digestMorning;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Thong bao"
        className="relative grid size-9 place-items-center rounded-lg text-text-secondary transition-colors hover:bg-surface-elevated hover:text-text-primary active:scale-95"
      >
        <Bell className="size-4.5" />
        {badgeCount > 0 ? (
          <span className="absolute right-1 top-1 flex min-w-[14px] items-center justify-center rounded-full bg-accent-primary px-0.5 text-[9px] font-bold leading-none text-white">
            {badgeCount > 9 ? "9+" : badgeCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-1.5 w-[min(360px,92vw)] overflow-hidden rounded-xl border border-border-default bg-surface-modal shadow-2xl">
          <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
            <span className="text-[12.5px] font-semibold text-text-primary">Thong bao</span>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="text-[10px] text-text-muted hover:text-accent-primary"
            >
              Cai dat
            </Link>
          </div>

          {!anyEnabled ? (
            <div className="px-3 py-6 text-center text-[12px] text-text-muted">
              Tat ca kenh thong bao dang tat. Bat trong Settings.
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto">
              {showDigest ? (
                <Link
                  href="/reports"
                  onClick={() => {
                    markDigest();
                    setOpen(false);
                  }}
                  className="block border-b border-border-subtle bg-accent-primary/5 px-3 py-2.5 hover:bg-accent-primary/10"
                >
                  <span className="text-[11px] font-semibold text-accent-primary">Digest buoi sang</span>
                  <span className="mt-0.5 block text-[12px] text-text-primary">
                    Tom tat dau phien — mo Ban tin
                  </span>
                </Link>
              ) : null}

              {showReport ? (
                <Link
                  href="/reports"
                  onClick={() => {
                    markReport();
                    setOpen(false);
                  }}
                  className="block border-b border-border-subtle px-3 py-2.5 hover:bg-surface-elevated"
                >
                  <span className="text-[11px] font-semibold text-text-secondary">Ban tin moi</span>
                  <span className="mt-0.5 block text-[12px] text-text-primary">
                    Morning Brief / Market Summary — /reports
                  </span>
                </Link>
              ) : null}

              {n.priceAlerts && triggeredAlerts.length > 0 ? (
                <div className="border-b border-border-subtle">
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Canh bao gia
                  </div>
                  <ul>
                    {triggeredAlerts.map((a) => (
                      <li key={a.id}>
                        <Link
                          href={`/stocks/${encodeURIComponent(a.symbol)}`}
                          onClick={() => setOpen(false)}
                          className="block px-3 py-2 hover:bg-surface-elevated"
                        >
                          <span className="font-semibold text-accent-primary">{a.symbol}</span>
                          <span className="ml-2 num text-[12px] text-text-secondary">
                            {a.price != null ? a.price.toLocaleString("vi-VN") : "—"}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <Link
                    href="/journal"
                    onClick={() => setOpen(false)}
                    className="block px-3 py-1.5 text-[11px] text-accent-primary hover:underline"
                  >
                    Quan ly canh bao
                  </Link>
                </div>
              ) : null}

              {n.marketNews ? (
                <div>
                  <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                    Tin thi truong
                  </div>
                  {articles.length === 0 ? (
                    <div className="px-3 py-4 text-center text-[12px] text-text-muted">Chua co tin</div>
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
                              <span className="mt-0.5 block text-[10px] text-text-muted">
                                {a.source}
                              </span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
