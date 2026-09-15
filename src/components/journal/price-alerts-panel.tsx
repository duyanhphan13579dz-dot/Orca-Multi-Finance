"use client";

import { useState } from "react";
import { Badge, Panel } from "@/components/ui";
import {
  addAlert,
  removeAlert,
  type AlertDirection,
  type PriceAlert,
} from "@/lib/alerts-store";
import {
  useNotificationPermission,
  usePriceAlertsList,
} from "@/lib/hooks/use-price-alerts";
import { Bell, BellOff, BellRing, Plus, Trash2 } from "lucide-react";

export function PriceAlertsPanel() {
  const { alerts, refresh } = usePriceAlertsList();
  const { permission, request } = useNotificationPermission();
  const [showForm, setShowForm] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [price, setPrice] = useState("");
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [reason, setReason] = useState("");

  const active = alerts.filter((a) => a.status === "active");
  const triggered = alerts.filter((a) => a.status === "triggered");

  const submit = async () => {
    const sym = symbol.trim().toUpperCase();
    const target = Number(price);
    if (!sym || !Number.isFinite(target) || target <= 0) return;
    if (permission === "default") await request();
    addAlert({ symbol: sym, targetPrice: target, direction, reason });
    setSymbol("");
    setPrice("");
    setReason("");
    setShowForm(false);
    refresh();
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
          Đặt mức giá + lý do. Khi giá chạm mức (app đang mở hoặc tab nền), hệ thống gửi thông báo
          đẩy tới thiết bị — cần cấp quyền thông báo trình duyệt.
        </p>

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
                <option value="above">Giá ≥ mức (phá kháng cự / chốt lời)</option>
                <option value="below">Giá ≤ mức (phá hỗ trợ / cắt lỗ)</option>
                <option value="cross">Giá đi qua mức (cross)</option>
              </select>
            </label>
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
  const dirLabel =
    alert.direction === "above" ? "≥" : alert.direction === "below" ? "≤" : "↔";
  const isTrig = alert.status === "triggered";
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${
        isTrig ? "border-positive/30 bg-positive/5" : "border-border-subtle"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-semibold text-text-primary">{alert.symbol}</span>
          <span className="num text-[12px] text-text-secondary">
            {dirLabel} {alert.targetPrice.toLocaleString("vi-VN")}
          </span>
          <Badge tone={isTrig ? "up" : "accent">{isTrig ? "Đã kích hoạt" : "Đang theo dõi"}</Badge>
        </div>
        {alert.reason && (
          <p className="mt-0.5 text-[11.5px] text-text-muted">{alert.reason}</p>
        )}
        <p className="mt-0.5 text-[10px] text-text-muted">
          Tạo {new Date(alert.createdAt).toLocaleString("vi-VN")}
          {alert.triggeredAt &&
            ` · Chạm ${alert.triggeredPrice?.toLocaleString("vi-VN")} lúc ${new Date(alert.triggeredAt).toLocaleString("vi-VN")}`}
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
