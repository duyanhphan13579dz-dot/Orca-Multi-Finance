"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Panel } from "@/components/ui";
import { loadAlerts, saveAlerts } from "@/lib/alerts-store";
import { loadPortfolioTrades, loadPortfolioWatchlist } from "@/lib/portfolio";
import { Cloud, CloudDownload, CloudUpload, RefreshCw } from "lucide-react";

type Status = {
  configured: boolean;
  spreadsheetId: string | null;
  serviceEmail: string | null;
};

export function SheetsSyncPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<"idle" | "pull" | "push" | "init">("idle");

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/sheets?action=status");
      const json = (await res.json()) as { data?: Status };
      setStatus(json.data ?? null);
    } catch {
      setStatus({ configured: false, spreadsheetId: null, serviceEmail: null });
    }
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const init = async () => {
    setBusy("init");
    setMsg(null);
    try {
      const res = await fetch("/api/v1/sheets?action=init");
      const json = (await res.json()) as { data?: { ok?: boolean }; error?: { message?: string } };
      if (!res.ok) throw new Error(json.error?.message ?? "init failed");
      setMsg("Da tao sheet Trades / Watchlist / Alerts (header).");
      await refreshStatus();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Loi init");
    } finally {
      setBusy("idle");
    }
  };

  const pull = async () => {
    setBusy("pull");
    setMsg(null);
    try {
      const res = await fetch("/api/v1/sheets?action=pull");
      const json = (await res.json()) as {
        data?: { trades?: unknown[]; watchlist?: unknown[]; alerts?: unknown[] };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? "pull failed");
      const trades = json.data?.trades ?? [];
      const watchlist = json.data?.watchlist ?? [];
      const alerts = json.data?.alerts ?? [];
      localStorage.setItem("orca.journal.v1", JSON.stringify(trades));
      localStorage.setItem("orca.watchlist.v1", JSON.stringify(watchlist));
      saveAlerts(alerts as ReturnType<typeof loadAlerts>);
      window.dispatchEvent(new Event("storage"));
      setMsg(`Da keo ve: ${trades.length} lenh, ${watchlist.length} watch, ${alerts.length} alert.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Loi pull");
    } finally {
      setBusy("idle");
    }
  };

  const push = async () => {
    setBusy("push");
    setMsg(null);
    try {
      const trades = loadPortfolioTrades();
      const watchlist = loadPortfolioWatchlist();
      const alerts = loadAlerts();
      const res = await fetch("/api/v1/sheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "push", trades, watchlist, alerts }),
      });
      const json = (await res.json()) as {
        data?: { pushed?: { trades: number; watchlist: number; alerts: number } };
        error?: { message?: string };
      };
      if (!res.ok) throw new Error(json.error?.message ?? "push failed");
      const p = json.data?.pushed;
      setMsg(`Da day len Sheet: ${p?.trades ?? 0} lenh, ${p?.watchlist ?? 0} watch, ${p?.alerts ?? 0} alert.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Loi push");
    } finally {
      setBusy("idle");
    }
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Cloud className="size-4 text-accent-primary" />
          Google Sheets backend
          {status?.configured ? (
            <Badge tone="up">Da cau hinh</Badge>
          ) : (
            <Badge tone="warn">Chua cau hinh</Badge>
          )}
        </span>
      }
    >
      <div className="space-y-3 text-[12px]">
        <p className="text-text-muted">
          Dong bo nhat ky lenh, watchlist va canh bao gia voi Google Sheets (service account).
          Local van la nguon chinh khi offline; Sheets la ban sao cloud.
        </p>
        {status?.configured ? (
          <p className="font-mono text-[11px] text-text-secondary">
            Sheet: {status.spreadsheetId}
            {status.serviceEmail ? ` · ${status.serviceEmail}` : ""}
          </p>
        ) : (
          <p className="text-warning">
            Thieu env: GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_ID
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!status?.configured || busy !== "idle"}
            onClick={() => void init()}
            className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1.5 text-[11px] disabled:opacity-40"
          >
            <RefreshCw className="size-3.5" />
            Init tabs
          </button>
          <button
            type="button"
            disabled={!status?.configured || busy !== "idle"}
            onClick={() => void pull()}
            className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2.5 py-1.5 text-[11px] disabled:opacity-40"
          >
            <CloudDownload className="size-3.5" />
            Keo ve (Pull)
          </button>
          <button
            type="button"
            disabled={!status?.configured || busy !== "idle"}
            onClick={() => void push()}
            className="inline-flex items-center gap-1 rounded-md bg-accent-primary/15 px-2.5 py-1.5 text-[11px] font-medium text-accent-primary disabled:opacity-40"
          >
            <CloudUpload className="size-3.5" />
            Day len (Push)
          </button>
        </div>
        {msg ? <p className="text-[11.5px] text-text-secondary">{msg}</p> : null}
        {busy !== "idle" ? <p className="text-[11px] text-text-muted">Dang xu ly ({busy})…</p> : null}
      </div>
    </Panel>
  );
}
