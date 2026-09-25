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
  const [webhook, setWebhook] = useState<WebhookConfig>(() => loadWebhookConfig());
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
        (kind === "ceiling" ? "Cảnh báo chạm trần" : kind === "floor" ? "Cảnh báo chạm sàn" : ""),
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
        reason: "Kiểm tra webhook Orca",
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
      ? "Đã bật thông báo"
      : permission === "denied"
        ? "Bị chặn thông báo"
        : permission === "unsupported"
          ? "Trình duyệt không hỗ trợ"
          : "Chưa cấp quyền";

  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          <BellRing className="size-4 text-accent-primary" />
          Cảnh báo giá
          <Badge tone={permTone}>{permLabel}</Badge>
          {webhook.enabled && webhook.url ? (
            <Badge tone="accent">Webhook bật</Badge>
          ) : null}
        </span>
      }
      right={
        <div className="flex items-center gap-1.5">
          {permission !== "granted" && permission !== "unsupported" && (
            <button
              type="button"
              onClick={() => void request()}
              className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-elevated"
            >
              {permission === "denied" ? <BellOff className="size-3.5" /> : <Bell className="size-3.5" />}
              Cấp quyền
            </button>
          )}
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
            Tạo cảnh báo
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-[11.5px] text-text-muted">
          Đặt mức giá, trần/sàn + lý do. Khi kích hoạt (app đang mở), gửi thông báo trình duyệt và
          (tuỳ chọn) webhook Discord / Slack / generic.
        </p>

        {showWebhook && (
          <div className="grid gap-2 rounded-lg border border-border-subtle bg-surface-elevated/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium text-text-primary">Webhook cảnh báo</span>
              <label className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                <input
                  type="checkbox"
                  checked={webhook.enabled}
                  onChange={(e) => setWebhook((w) => ({ ...w, enabled: e.target.checked }))}
                />
                Bật gửi webhook
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
                URL webhook (https)
              </span>
              <input
                value={webhook.url}
                onChange={(e) => setWebhook((w) => ({ ...w, url: e.target.value }))}
                placeholder="https://discord.com/api/webhooks/…"
                className="input w-full font-mono text-[12px]"
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                Secret (tuỳ chọn — header X-Orca-Secret)
              </span>
              <input
                value={webhook.secret}
                onChange={(e) => setWebhook((w) => ({ ...w, secret: e.target.value }))}
                placeholder="••••••••"
                className="input w-full font-mono text-[12px]"
                type="password"
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
                Lưu webhook
              </button>
              <button
                type="button"
                onClick={() => void testWebhook()}
                disabled={!isValidWebhookUrl(webhook.url)}
                className="rounded-md border border-border-subtle px-3 py-1.5 text-[12px] text-text-secondary disabled:opacity-40"
              >
                Gửi thử
              </button>
              {webhookTest === "ok" ? (
                <span className="text-[11px] text-up">Đã gửi thành công</span>
              ) : null}
              {webhookTest === "fail" ? (
                <span className="text-[11px] text-down">Gửi thất bại — kiểm tra URL</span>
              ) : null}
            </div>
            <p className="text-[10.5px] text-text-muted">
              Discord: Server Settings → Integrations → Webhooks. Slack: Incoming Webhook app.
              Payload đi qua proxy <code className="text-[10px]">/api/v1/alerts/webhook</code> để
              tránh CORS.
            </p>
          </div>
        )}

        {showForm && (
          <div className="grid gap-2 rounded-lg border border-border-subtle bg-surface-elevated/40 p-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                Mã cổ phiếu
              </span>
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="VCB"
                className="input w-full"
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                Loại cảnh báo
              </span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as AlertKind)}
                className="input w-full"
              >
                <option value="price">Mức giá cố định</option>
                <option value="ceiling">Chạm trần phiên</option>
                <option value="floor">Chạm sàn phiên</option>
              </select>
            </label>
            {kind === "price" ? (
              <>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                    Giá cảnh báo
                  </span>
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="65000"
                    inputMode="decimal"
                    className="input w-full"
                  />
                </label>
                <label className="block">
                  <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                    Điều kiện
                  </span>
                  <select
                    value={direction}
                    onChange={(e) => setDirection(e.target.value as AlertDirection)}
                    className="input w-full"
                  >
                    <option value="above">Giá ≥ mức</option>
                    <option value="below">Giá ≤ mức</option>
                    <option value="cross">Giá đi qua mức (cross)</option>
                  </select>
                </label>
              </>
            ) : (
              <p className="sm:col-span-2 text-[11.5px] text-text-muted">
                {kind === "ceiling"
                  ? "Kích hoạt khi giá khớp ≈ trần phiên (màu tím)."
                  : "Kích hoạt khi giá khớp ≈ sàn phiên (màu xanh lam)."}
              </p>
            )}
            <label className="block sm:col-span-2">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wider text-text-muted">
                Lý do đặt cảnh báo
              </span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ví dụ: test lại vùng hỗ trợ tuần, chờ xác nhận volume…"
                className="input w-full"
                maxLength={280}
              />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <button
                type="button"
                onClick={() => void submit()}
                className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white"
              >
                Lưu cảnh báo
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-md px-3 py-1.5 text-[12px] text-text-muted"
              >
                Hủy
              </button>
            </div>
          </div>
        )}

        {active.length === 0 && triggered.length === 0 ? (
          <p className="text-[12px] text-text-muted">Chưa có cảnh báo nào.</p>
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
  const dirLabel =
    kind === "ceiling"
      ? "Trần"
      : kind === "floor"
        ? "Sàn"
        : alert.direction === "above"
          ? "≥"
          : alert.direction === "below"
            ? "≤"
            : "↔";
  const isTrig = alert.status === "triggered";
  const kindTone =
    kind === "ceiling" ? "text-violet-300" : kind === "floor" ? "text-sky-300" : "text-text-secondary";

  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
        isTrig
          ? kind === "ceiling"
            ? "border-violet-500/30 bg-violet-500/5"
            : kind === "floor"
              ? "border-sky-400/30 bg-sky-400/5"
              : "border-positive/30 bg-positive/5"
          : "border-border-subtle"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-text-primary">{alert.symbol}</span>
          <span className={`num text-[12px] ${kindTone}`}>
            {dirLabel}
            {kind === "price" ? ` ${alert.targetPrice.toLocaleString("vi-VN")}` : ""}
          </span>
          <Badge tone={isTrig ? "up" : "neutral">{isTrig ? "Đã kích hoạt" : "Đang theo dõi"}</Badge>
        </div>
        {alert.reason && (
          <p className="mt-0.5 text-[11.5px] text-text-muted">{alert.reason}</p>
        )}
        <p className="mt-0.5 text-[10px] text-text-muted">
          Tạo {new Date(alert.createdAt).toLocaleString("vi-VN")}
          {alert.triggeredAt &&
            ` · Chạm ${alert.triggeredPrice?.toLocaleString("vi-VN")} lúc ${
              new Date(alert.triggeredAt).toLocaleString("vi-VN")
            }`}
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-text-muted hover:text-negative"
        aria-label="Xóa cảnh báo"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}
