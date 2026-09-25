"use client";

import { useEffect, useState } from "react";
import { Badge, Panel } from "@/components/ui";
import {
  addAlert,
  removeAlert,
  type AlertDirection,
  type AlertKind,
  type PriceAlert,
} from "@/lib/alerts-store";
import {
  dispatchAlertWebhook,
  useNotificationPermission,
  usePriceAlertsList,
} from "@/lib/hooks/use-price-alerts";
import {
  isValidWebhookUrl,
  loadWebhookConfig,
  saveWebhookConfig,
  type WebhookConfig,
  type WebhookProvider,
} from "@/lib/webhook-store";
import { Bell, BellOff, BellRing, Plus, Trash2, Webhook } from "lucide-react";

export function PriceAlertsPanel() {
  const { alerts, refresh } = usePriceAlertsList();
  const { permission, request } = useNotificationPermission();
  const [showForm, setShowForm] = useState(false);
  const [showWebhook, setShowWebhook] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [kind, setKind] = useState<AlertKind>("price");
  const [reason, setReason] = useState("");
  const [webhook, setWebhook] = useState<WebhookConfig>(() => {
    const cfg = loadWebhookConfig();
    return { ...cfg, pollMs: cfg.pollMs || 5000 };
  });
  const [webhookTest, setWebhookTest] = useState<"idle" | "ok" | "fail">("idle");

  useEffect(() => {
    const onChange = () => setWebhook(loadWebhookConfig());
    window.addEventListener("orca-webhook-changed", onChange as EventListener);
    return () => window.removeEventListener("orca-webhook-changed", onChange as EventListener);
  }, []);

  const active = alerts.filter((a) => a.status === "active");
  const triggered = alerts.filter((a) => a.status === "triggered");

  const submit = async () => {
    const sym = symbol.trim().toUpperCase();
    const target = Number(price);
    if (!sym) return;
    if (kind === "price" && (!Number.isFinite(target) || target <= 0)) return;
    if (permission === "default") await request();
    addAlert({
      symbol: sym,
      targetPrice: kind === "price" ? target : 0,
      direction: kind === "ceiling" ? "above" : kind === "floor" ? "below" : direction,
      kind,
      reason:
        reason ||
        (kind === "ceiling" ? "Canh bao cham tran" : kind === "floor" ? "Canh bao cham san" : ""),
    });
    setSymbol("");
    setPrice("");
    setReason("");
    setShowForm(false);
    refresh();
  };

  const saveWebhook = () => {
    saveWebhookConfig(webhook);
    setWebhookTest("idle");
  };

  const testWebhook = async () => {
    saveWebhookConfig({ ...webhook, enabled: true });
    const ok = await dispatchAlertWebhook(
      {
        id: "test",
        symbol: "TEST",
        targetPrice: 100,
        direction: "above",
        kind: "price",
        reason: "Kiem tra webhook Discord Orca",
        status: "triggered",
        createdAt: Date.now(),
        triggeredAt: Date.now(),
        triggeredPrice: 100,
      },
      100,
    );
    setWebhookTest(ok ? "ok" : "fail");
  };

  const permTone =
    permission === "granted" ? "up" : permission === "denied" ? "down" : "neutral";
  const permLabel =
    permission === "granted"
      ? "Da bat thong bao"
      : permission === "denied"
        ? "Bi chan thong bao"
        : permission === "unsupported"
          ? "Trinh duyet khong ho tro"
          : "Chua cap quyen";

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <BellRing className="size-4 text-accent-primary" />
          Canh bao gia
          <Badge tone={permTone}>{permLabel}</Badge>
          {webhook.enabled && webhook.url ? (
            <Badge tone="accent">Webhook bat</Badge>
          ) : null}
        </span>
      }
      right={
        <div className="flex items-center gap-1.5">
          {permission !== "granted" && permission !== "unsupported" ? (
            <button
              type="button"
              onClick={() => void request()}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-elevated"
            >
              {permission === "denied" ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
              Cap quyen
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowWebhook((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-elevated"
          >
            <Webhook className="size-3.5" />
            Webhook
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="inline-flex items-center gap-1 rounded-md bg-accent-primary/15 px-2 py-1 text-[11px] font-medium text-accent-primary"
          >
            <Plus className="size-3.5" />
            Tao canh bao
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[11.5px] text-text-muted">
          Dat muc gia / tran / san. Khi kich hoat: thong bao trinh duyet + Discord webhook.
          Poll mac dinh 5s (tuy chinh trong Webhook).
        </p>

        {showWebhook ? (
          <div className="grid gap-2 rounded-lg border border-border-subtle bg-surface-elevated/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-text-primary">Webhook Discord</span>
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={webhook.enabled}
                  onChange={(e) => setWebhook((w) => ({ ...w, enabled: e.target.checked }))}
                />
                Bat gui webhook
              </label>
            </div>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                Provider
              </span>
              <select
                value={webhook.provider}
                onChange={(e) =>
                  setWebhook((w) => ({ ...w, provider: e.target.value as WebhookProvider }))
                }
                className="input w-full"
              >
                <option value="discord">Discord</option>
                <option value="slack">Slack</option>
                <option value="generic">Generic JSON</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                Toc do poll (canh bao gia)
              </span>
              <select
                value={String(webhook.pollMs || 5000)}
                onChange={(e) =>
                  setWebhook((w) => ({ ...w, pollMs: Number(e.target.value) }))
                }
                className="input w-full"
              >
                <option value="3000">3 giay (nhanh)</option>
                <option value="5000">5 giay (khuyen nghi)</option>
                <option value="10000">10 giay</option>
                <option value="15000">15 giay</option>
                <option value="30000">30 giay</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                URL webhook Discord (https)
              </span>
              <input
                value={webhook.url}
                onChange={(e) => {
                  const url = e.target.value;
                  const isDc =
                    url.includes("discord.com/api/webhooks") ||
                    url.includes("discordapp.com/api/webhooks");
                  setWebhook((w) => ({ ...w, url, provider: isDc ? "discord" : w.provider }));
                }}
                placeholder="https://discord.com/api/webhooks/ID/TOKEN"
                className="input w-full font-mono text-[12px]"
                autoComplete="off"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveWebhook}
                disabled={webhook.url.length > 0 && !isValidWebhookUrl(webhook.url)}
                className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                Luu webhook
              </button>
              <button
                type="button"
                onClick={() => void testWebhook()}
                disabled={!isValidWebhookUrl(webhook.url)}
                className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary disabled:opacity-40"
              >
                Gui thu Discord
              </button>
              {webhookTest === "ok" ? (
                <span className="text-[11px] text-up">Da gui thanh cong</span>
              ) : null}
              {webhookTest === "fail" ? (
                <span className="text-[11px] text-down">That bai — kiem tra URL</span>
              ) : null}
            </div>
            <p className="text-[10.5px] text-text-muted">
              Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL.
              Dan URL vao o tren, bat "Gui webhook", bam Luu roi Gui thu.
            </p>
          </div>
        ) : null}

        {showForm ? (
          <div className="grid gap-2 rounded-lg border border-border-subtle bg-surface-elevated/40 p-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ma</span>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="VCB"
                className="input w-full"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Loai</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AlertKind)}
                className="input w-full"
              >
                <option value="price">Muc gia</option>
                <option value="ceiling">Cham tran</option>
                <option value="floor">Cham san</option>
              </select>
            </label>
            {kind === "price" ? (
              <>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Gia</span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="65000"
                    inputMode="decimal"
                    className="input w-full"
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Dieu kien</span>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as AlertDirection)}
                    className="input w-full"
                  >
                    <option value="above">Gia &gt;= muc</option>
                    <option value="below">Gia &lt;= muc</option>
                    <option value="cross">Cross</option>
                  </select>
                </label>
              </>
            ) : (
              <p className="sm:col-span-2 text-[11.5px] text-text-muted">
                {kind === "ceiling" ? "Kich hoat khi gia ~ tran." : "Kich hoat khi gia ~ san."}
              </p>
            )}
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">Ly do</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input w-full"
                maxLength={280}
              />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button type="button" onClick={() => void submit()} className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white">
                Luu
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="rounded-md px-3 py-1.5 text-[12px] text-text-muted">
                Huy
              </button>
            </div>
          </div>
        ) : null}

        {active.length === 0 && triggered.length === 0 ? (
          <p className="text-[12px] text-text-muted">Chua co canh bao.</p>
        ) : (
          <div className="space-y-2">
            {active.map((a) => (
              <AlertRow key={a.id} alert={a} onRemove={() => { removeAlert(a.id); refresh(); }} />
            ))}
            {triggered.map((a) => (
              <AlertRow key={a.id} alert={a} onRemove={() => { removeAlert(a.id); refresh(); }} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function AlertRow({ alert, onRemove }: { alert: PriceAlert; onRemove: () => void }) {
  const kind = alert.kind ?? "price";
  const isTrig = alert.status === "triggered";
  let dirLabel = "~";
  if (kind === "ceiling") dirLabel = "Tran";
  else if (kind === "floor") dirLabel = "San";
  else if (alert.direction === "above") dirLabel = ">=";
  else if (alert.direction === "below") dirLabel = "<=";

  let kindTone = "text-text-secondary";
  if (kind === "ceiling") kindTone = "text-violet-300";
  else if (kind === "floor") kindTone = "text-sky-300";

  let rowClass = "border-border-subtle";
  if (isTrig) {
    if (kind === "ceiling") rowClass = "border-violet-500/30 bg-violet-500/5";
    else if (kind === "floor") rowClass = "border-sky-400/30 bg-sky-400/5";
    else rowClass = "border-positive/30 bg-positive/5";
  }

  const pricePart = kind === "price" ? " " + alert.targetPrice.toLocaleString("vi-VN") : "";
  const statusLabel = isTrig ? "Da kich hoat" : "Dang theo doi";
  const badgeTone: "up" | "neutral" = isTrig ? "up" : "neutral";

  return (
    <div className={"flex items-start gap-2 rounded-lg border px-3 py-2 " + rowClass}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-text-primary">{alert.symbol}</span>
          <span className={"num text-[12px] " + kindTone}>
            {dirLabel}
            {pricePart}
          </span>
          <Badge tone={badgeTone}>{statusLabel}</Badge>
        </div>
        {alert.reason ? <p className="mt-0.5 text-[11.5px] text-text-muted">{alert.reason}</p> : null}
      </div>
      <button type="button" onClick={onRemove} className="text-text-muted hover:text-negative" aria-label="Xoa">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
