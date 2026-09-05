"use client";

import { useState } from "react";
import { useSettings, DASHBOARD_WIDGETS } from "@/lib/settings";
import { Badge, formatAge, Panel } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import type { ProviderStatus } from "@/lib/types";
import { Row, Section, Seg, SavedNote, Switch } from "@/components/settings-panels-extra";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Database, LogIn, Server, ShieldCheck, XCircle } from "lucide-react";

/* --------------------------------- DASHBOARD ------------------------------- */

export function DashboardTab() {
  const { settings, update } = useSettings();
  const d = settings.dashboard;
  const widgets = [...d.widgets].sort((a, b) => a.order - b.order);

  const setWidgets = (w: typeof d.widgets) => update({ dashboard: { ...d, widgets: w } });
  const move = (id: string, dir: -1 | 1) => {
    const arr = widgets.map((x) => ({ ...x }));
    const i = arr.findIndex((x) => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    setWidgets(arr.map((x, idx) => ({ ...x, order: idx })));
  };

  return (
    <>
      <Section title="Bố cục Dashboard" desc="Ẩn/hiện và sắp xếp widget trên trang Tổng quan — áp dụng ngay.">
        <ul className="space-y-1">
          {widgets.map((w, idx) => {
            const meta = DASHBOARD_WIDGETS.find((x) => x.id === w.id);
            return (
              <li key={w.id} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-2">
                <div className="flex flex-col">
                  <button onClick={() => move(w.id, -1)} disabled={idx === 0} className="text-text-muted hover:text-text-primary disabled:opacity-30" aria-label="Lên"><ArrowUp className="size-3" /></button>
                  <button onClick={() => move(w.id, 1)} disabled={idx === widgets.length - 1} className="text-text-muted hover:text-text-primary disabled:opacity-30" aria-label="Xuống"><ArrowDown className="size-3" /></button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium text-text-primary">{meta?.label ?? w.id}</div>
                  <div className="text-[10.5px] text-text-muted">{meta?.hint}</div>
                </div>
                <Switch on={w.visible} onChange={(v) => setWidgets(widgets.map((x) => (x.id === w.id ? { ...x, visible: v } : x)))} label={`Hiện ${meta?.label}`} />
              </li>
            );
          })}
        </ul>
        <button
          onClick={() => setWidgets(DASHBOARD_WIDGETS.map((w, i) => ({ id: w.id, visible: true, order: i })))}
          className="text-[11.5px] text-accent-primary hover:underline"
        >
          Khôi phục mặc định
        </button>
      </Section>
      <Section title="Chart Engine" desc="Tuỳ chọn mặc định cho Orca Chart — persist và áp dụng tức thờì trên mọi chart.">
        <Row label="Loại chart mặc định">
          <Seg value={settings.chart.chartType} onChange={(v) => update({ chart: { ...settings.chart, chartType: v } })}
            options={[{ value: "candles", label: "Candles" }, { value: "area", label: "Area" }]} />
        </Row>
        <Row label="Hiển thị Volume"><Switch on={settings.chart.volume} onChange={(v) => update({ chart: { ...settings.chart, volume: v } })} label="Volume" /></Row>
        <Row label="Grid"><Switch on={settings.chart.grid} onChange={(v) => update({ chart: { ...settings.chart, grid: v } })} label="Grid" /></Row>
        <Row label="Crosshair magnet"><Switch on={settings.chart.crosshairMagnet} onChange={(v) => update({ chart: { ...settings.chart, crosshairMagnet: v } })} label="Magnet" /></Row>
        <Row label="Log scale"><Switch on={settings.chart.logScale} onChange={(v) => update({ chart: { ...settings.chart, logScale: v } })} label="Log scale" /></Row>
        <Row label="Chỉ báo mặc định" hint="EMA · Bollinger · VWAP · RSI · MACD · S/R levels">
          <div className="flex gap-1.5">
            {(["ema", "bollinger", "vwap", "rsi", "macd", "srLevels"] as const).map((k) => (
              <button
                key={k}
                onClick={() => update({ chart: { ...settings.chart, indicators: { ...settings.chart.indicators, [k]: !settings.chart.indicators[k] } } })}
                className={`rounded border px-1.5 py-0.5 text-[10.5px] uppercase ${
                  settings.chart.indicators[k] ? "border-accent-primary/40 bg-accent-primary/12 text-accent-primary" : "border-border-subtle text-text-muted"
                }`}
              >
                {k === "srLevels" ? "S/R" : k}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="Mặc định" desc="Giá trị khởi tạo khi mở dashboard và trang chi tiết.">
        <Row label="Tài sản mặc định" hint="Dùng khi search Enter không có kết quả">
          <input
            value={d.defaultAsset}
            onChange={(e) => update({ dashboard: { ...d, defaultAsset: e.target.value.toUpperCase().slice(0, 14) } })}
            className="num input w-36 uppercase"
          />
        </Row>
        <Row label="Thị trường mặc định">
          <Seg value={d.defaultMarket} onChange={(v) => update({ dashboard: { ...d, defaultMarket: v } })}
            options={[{ value: "stocks", label: "Cổ phiếu" }, { value: "crypto", label: "Crypto" }, { value: "forex", label: "Forex" }, { value: "commodities", label: "Hàng hóa" }]} />
        </Row>
        <Row label="Khung thờ gian mặc định" hint="Chart crypto khi mở trang detail">
          <Seg value={d.defaultTimeframe} onChange={(v) => update({ dashboard: { ...d, defaultTimeframe: v } })}
            options={[{ value: "15m", label: "15m" }, { value: "1h", label: "1H" }, { value: "4h", label: "4H" }, { value: "1d", label: "1D" }]} />
        </Row>
      </Section>
    </>
  );
}

/* ------------------------------- NOTIFICATIONS ----------------------------- */

export function NotificationsTab() {
  const { settings, update } = useSettings();
  const n = settings.notifications;
  return (
    <Section title="Thông báo" desc="Tuỳ chọn nhận thông tin — lưu persistent và áp dụng cho bell trên header.">
      <Row label="Tin thị trường mới" hint="Badge chuông khi có tin <30 phút">
        <Switch on={n.marketNews} onChange={(v) => update({ notifications: { ...n, marketNews: v } })} label="Tin thị trường" />
      </Row>
      <Row label="Cảnh báo giá (alerts)" hint="Khi alert engine kích hoạt (roadmap)">
        <Switch on={n.priceAlerts} onChange={(v) => update({ notifications: { ...n, priceAlerts: v } })} label="Cảnh báo giá" />
      </Row>
      <Row label="Bản tin mới sẵn sàng" hint="Morning Brief / báo cáo mới">
        <Switch on={n.reportReady} onChange={(v) => update({ notifications: { ...n, reportReady: v } })} label="Bản tin" />
      </Row>
      <Row label="Digest buổi sáng" hint="Tóm tắt tổng hợp đầu phiên">
        <Switch on={n.digestMorning} onChange={(v) => update({ notifications: { ...n, digestMorning: v } })} label="Digest" />
      </Row>
    </Section>
  );
}

/* ------------------------------ DATA & REALTIME ---------------------------- */

export function DataRealtimeTab() {
  const { settings, update } = useSettings();
  const r = settings.realtime;
  const { data } = useApi<{ providers: ProviderStatus[]; serverTime: string }>("/api/v1/system/providers", { refreshInterval: 10_000 });

  return (
    <>
      <Section title="Trạng thái Provider (realtime)" desc="Trực tiếp từ monitoring thật của Data Engine — không giả lập.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-[11.5px]">
            <thead>
              <tr className="border-b border-border-subtle text-left text-[10px] uppercase tracking-wider text-text-muted">
                <th className="pb-1.5 font-medium">Provider</th>
                <th className="pb-1.5 font-medium">Status</th>
                <th className="pb-1.5 text-right font-medium">Latency</th>
                <th className="pb-1.5 text-right font-medium">Success cuối</th>
                <th className="pb-1.5 text-right font-medium">Circuit</th>
              </tr>
            </thead>
            <tbody>
              {(data?.providers ?? []).map((p) => (
                <tr key={p.provider} className="border-b border-border-subtle/50">
                  <td className="py-1.5 font-medium text-text-primary">{p.provider}</td>
                  <td className="py-1.5">
                    <Badge tone={p.status === "healthy" ? "up" : p.status === "down" ? "down" : p.status === "degraded" ? "warn" : "neutral"}>
                      ● {p.status.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="num py-1.5 text-right text-text-secondary">{p.avgLatencyMs != null ? `${p.avgLatencyMs}ms` : "—"}</td>
                  <td className="num py-1.5 text-right text-text-secondary">{p.lastSuccessAt ? formatAge(Date.now() - Date.parse(p.lastSuccessAt)) : "—"}</td>
                  <td className={`py-1.5 text-right ${p.circuit === "open" ? "text-negative" : p.circuit === "half-open" ? "text-warning" : "text-positive"}`}>{p.circuit}</td>
                </tr>
              ))}
              {!data?.providers.length && (
                <tr><td colSpan={5} className="py-3 text-text-muted">Chưa có provider nào được gọi trong phiên server này — mở dashboard để kích hoạt dòng dữ liệu.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {data?.serverTime && <p className="text-[10.5px] text-text-muted">Cập nhật {formatAge(Date.now() - Date.parse(data.serverTime))} · làm mới tự động mỗi 10s</p>}
      </Section>

      <Section title="Tuỳ chọn Realtime" desc="Backend luôn giữ quyền rate-limit/backoff — cấu hình này chỉ nằm trong ngưỡng an toàn.">
        <Row label="Live updates" hint="Tắt = không polling; dữ liệu nạp một lần">
          <Switch on={r.liveUpdates} onChange={(v) => update({ realtime: { ...r, liveUpdates: v } })} label="Live updates" />
        </Row>
        <Row label="Low Data Mode" hint="Giãn interval ×4, tắt animation ticker, refresh chậm">
          <Switch on={r.lowDataMode} onChange={(v) => update({ realtime: { ...r, lowDataMode: v } })} label="Low data" />
        </Row>
        <Row label="Tần suất ưu tiên" hint="Nhân tốc cho các adapter không streaming">
          <Seg value={String(r.refreshSeconds)} onChange={(v) => update({ realtime: { ...r, refreshSeconds: Number(v) } })}
            options={["5", "10", "15", "30", "60"].map((s) => ({ value: s, label: `${s}s` }))} />
        </Row>
        <Row label="Auto reconnect" hint="Retry khi request thất bại">
          <Switch on={r.autoReconnect} onChange={(v) => update({ realtime: { ...r, autoReconnect: v } })} label="Auto reconnect" />
        </Row>
        <Row label="Background refresh" hint="Revalidate khi focus lại tab trình duyệt">
          <Switch on={r.backgroundRefresh} onChange={(v) => update({ realtime: { ...r, backgroundRefresh: v } })} label="Background refresh" />
        </Row>
      </Section>
    </>
  );
}

/* ----------------------------------- AI ----------------------------------- */

export function AiTab() {
  const { settings, update } = useSettings();
  const a = settings.ai;
  const [showKey] = useState(false);
  return (
    <>
      <Section title="Phân tích" desc="Áp dụng cho ORCA Agent — gửi kèm mỗi câu hỏi.">
        <Row label="Độ sâu phân tích">
          <Seg value={a.depth} onChange={(v) => update({ ai: { ...a, depth: v } })}
            options={[{ value: "concise", label: "Ngắn gọn" }, { value: "standard", label: "Chuẩn" }, { value: "deep", label: "Sâu" }]} />
        </Row>
        <Row label="Phong cách trả lờì">
          <Seg value={a.style} onChange={(v) => update({ ai: { ...a, style: v } })}
            options={[{ value: "analyst", label: "Analyst" }, { value: "technical", label: "Kỹ thuật" }, { value: "brief", label: "Súc tích" }]} />
        </Row>
        <Row label="Ngôn ngữ phản hồi">
          <Seg value={a.language} onChange={(v) => update({ ai: { ...a, language: v } })}
            options={[{ value: "vi", label: "Tiếng Việt" }, { value: "en", label: "English" }]} />
        </Row>
        <Row label="Risk disclosure" hint="Mức ghi chú rủi ro cuối mỗi câu trả lờì">
          <Seg value={a.riskDisclosure} onChange={(v) => update({ ai: { ...a, riskDisclosure: v } })}
            options={[{ value: "standard", label: "Chuẩn" }, { value: "detailed", label: "Chi tiết" }, { value: "off", label: "Tắt" }]} />
        </Row>
      </Section>
      <Section title="Model provider" desc="Khóa AI chỉ tồn tại phía server — không bao giờ hiển thị tại đây.">
        <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-elevated p-3 text-[12px] text-text-secondary">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-positive" />
          <span>
            Engine deterministic (dữ liệu thật) luôn hoạt động. Khi server cấu hình <code className="text-accent-primary">AI_PROVIDER_KEY</code>, Agent tự nâng cấp lên LLM với context giới hạn trong dữ liệu đã fetch. API key không bao giờ đi qua trình duyệt{showKey ? "" : " — và không thể xem từ UI"}.
          </span>
        </div>
      </Section>
    </>
  );
}

/* --------------------------------- SECURITY -------------------------------- */

interface SessionRow { id: string; createdAt: string; userAgent: string | null; ip: string | null; expiresAt: string; current: boolean }
interface ActivityRow { id: number; action: string; meta: unknown; createdAt: string }

export function SecurityTab() {
  const { data: me } = useApi<{ user: { email: string } }>("/api/v1/auth/me");
  const { data: sess, mutate: mutateSess } = useApi<{ sessions: SessionRow[] }>(me ? "/api/v1/auth/sessions" : null, { refreshInterval: 30_000 });
  const { data: act } = useApi<{ activity: ActivityRow[] }>(me ? "/api/v1/auth/activity" : null, { refreshInterval: 30_000 });
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!me?.user) {
    return (
      <Section title="Bảo mật" desc="Đăng nhập để quản lý mật khẩu, phiên và hoạt động tài khoản.">
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border-default p-4">
          <LogIn className="size-5 text-accent-primary" />
          <div className="flex-1 text-[12.5px] text-text-secondary">Bạn chưa đăng nhập — quản lý bảo mật yêu cầu tài khoản.</div>
          <a href="/login" className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white">Đăng nhập</a>
        </div>
      </Section>
    );
  }

  const changePassword = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/v1/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: cur, next }),
      });
      const json = (await res.json()) as { success: boolean; error?: { message: string } };
      setMsg(json.success ? { ok: true, text: "Đã đổi mật khẩu thành công." } : { ok: false, text: json.error?.message ?? "Thất bại" });
      if (json.success) { setCur(""); setNext(""); }
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await fetch("/api/v1/auth/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await mutateSess();
  };

  const ACTION_VI: Record<string, string> = {
    login: "Đăng nhập", login_failed: "Đăng nhập thất bại", register: "Đăng ký",
    password_change: "Đổi mật khẩu", profile_update: "Cập nhật hồ sơ", session_revoke: "Thu hồi phiên",
  };

  return (
    <>
      <Section title="Đổi mật khẩu" desc="Mật khẩu mới được băm scrypt phía server.">
        <div className="grid max-w-sm gap-2">
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} placeholder="Mật khẩu hiện tại" className="input" autoComplete="current-password" />
          <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="Mật khẩu mới (≥8 ký tự)" className="input" autoComplete="new-password" />
          <div className="flex items-center gap-2">
            <button onClick={changePassword} disabled={busy || !cur || next.length < 8} className="rounded-md bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50">
              {busy ? "Đang xử lý…" : "Đổi mật khẩu"}
            </button>
            {msg && <span className={`flex items-center gap-1 text-[12px] ${msg.ok ? "text-positive" : "text-negative"}`}>{msg.ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}{msg.text}</span>}
          </div>
        </div>
      </Section>

      <Section title="Phiên đang hoạt động" desc="Session DB-backed — thu hồi có hiệu lực ngay (JWT cũng bị chặn).">
        <ul className="space-y-1.5">
          {(sess?.sessions ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 rounded-md border border-border-subtle bg-surface-elevated px-3 py-2">
              <ShieldCheck className={`size-4 shrink-0 ${s.current ? "text-positive" : "text-text-muted"}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-text-primary">{s.userAgent?.slice(0, 90) ?? "Thiết bị không xác định"}</div>
                <div className="text-[10.5px] text-text-muted">
                  {new Date(s.createdAt).toLocaleString("vi-VN")} · hết hạn {new Date(s.expiresAt).toLocaleDateString("vi-VN")}
                </div>
              </div>
              {s.current ? <Badge tone="up">phiên này</Badge> : (
                <button onClick={() => revoke(s.id)} className="rounded-md border border-negative/40 px-2 py-1 text-[11px] text-negative hover:bg-negative/10">Thu hồi</button>
              )}
            </li>
          ))}
          {!sess?.sessions?.length && <li className="text-[12px] text-text-muted">Không có phiên nào.</li>}
        </ul>
      </Section>

      <Section title="Hoạt động gần đây" desc="Audit trail của tài khoản (tối đa 20 sự kiện).">
        <ul className="space-y-1">
          {(act?.activity ?? []).map((a) => (
            <li key={a.id} className="flex items-center gap-2 text-[12px]">
              <span className={`size-1.5 rounded-full ${a.action.includes("failed") ? "bg-negative" : "bg-positive"}`} />
              <span className="text-text-primary">{ACTION_VI[a.action] ?? a.action}</span>
              <span className="num ml-auto text-[10.5px] text-text-muted">{new Date(a.createdAt).toLocaleString("vi-VN")}</span>
            </li>
          ))}
          {!act?.activity?.length && <li className="text-[12px] text-text-muted">Chưa có hoạt động.</li>}
        </ul>
      </Section>
    </>
  );
}

/* ---------------------------------- SYSTEM --------------------------------- */

interface SystemInfo {
  app: { name: string; version: string; environment: string };
  runtime: { uptimeSec: number; serverTime: string };
  database: { connected: boolean; latencyMs: number | null };
  redis: { configured: boolean; connected: boolean };
  dataEngine: { providersTotal: number; providersHealthy: number; providersDown: number; cache: { entries: number; hits: number; staleServed: number; inflight: number } };
  features: Record<string, boolean>;
}

export function SystemTab() {
  const { data } = useApi<SystemInfo>("/api/v1/system/info", { refreshInterval: 30_000 });
  const d = data;
  return (
    <>
      <Section title="Ứng dụng" desc="Thông tin build không nhạy cảm.">
        <Row label="Application"><span className="num text-[12.5px] text-text-primary">{d?.app.name ?? "ORCA Financial"} v{d?.app.version ?? "—"}</span></Row>
        <Row label="Environment"><Badge tone="accent">{d?.app.environment ?? "—"}</Badge></Row>
        <Row label="Server time"><span className="num text-[12.5px] text-text-secondary">{d ? new Date(d.runtime.serverTime).toLocaleString("vi-VN") : "—"}</span></Row>
        <Row label="Uptime (process)"><span className="num text-[12.5px] text-text-secondary">{d ? `${Math.floor(d.runtime.uptimeSec / 60)}p ${d.runtime.uptimeSec % 60}s` : "—"}</span></Row>
      </Section>
      <Section title="Data Engine" desc="Trạng thái hạ tầng dữ liệu (chi tiết provider tại /system).">
        <Row label="PostgreSQL" hint={d?.database.latencyMs != null ? `latency ${d.database.latencyMs}ms` : undefined}>
          <StatusPill ok={d?.database.connected} />
        </Row>
        <Row label="Redis" hint={d?.redis.configured ? "đã cấu hình" : "chưa cấu hình REDIS_URL — đang chạy memory cache"}>
          <StatusPill ok={d?.redis.configured ? d.redis.connected : undefined} na={!d?.redis.configured} />
        </Row>
        <Row label="Providers" hint="healthy / tổng số">
          <span className="num text-[12.5px] text-text-primary">{d ? `${d.dataEngine.providersHealthy}/${d.dataEngine.providersTotal}` : "—"}{d && d.dataEngine.providersDown > 0 ? ` · ${d.dataEngine.providersDown} down` : ""}</span>
        </Row>
        <Row label="Cache" hint="entries · hits · stale phục vụ">
          <span className="num text-[12.5px] text-text-secondary">{d ? `${d.dataEngine.cache.entries} · ${d.dataEngine.cache.hits} · ${d.dataEngine.cache.staleServed}` : "—"}</span>
        </Row>
        <a href="/system" className="inline-flex items-center gap-1.5 text-[12px] text-accent-primary hover:underline">
          <Server className="size-3.5" /> Mở Ops Dashboard đầy đủ
        </a>
      </Section>
      <Section title="Nguồn dữ liệu đã cấu hình" desc="Feature flags — chỉ hiển thị có/không, không lộ khóa.">
        <div className="grid grid-cols-2 gap-1.5">
          {d && Object.entries(d.features).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-1.5">
              {v ? <CheckCircle2 className="size-3.5 text-positive" /> : <AlertTriangle className="size-3.5 text-warning" />}
              <span className="text-[11.5px] text-text-secondary">{k}</span>
              <span className="ml-auto text-[10px] text-text-muted">{v ? "configured" : "pending"}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function StatusPill({ ok, na }: { ok: boolean | undefined; na?: boolean }) {
  if (na) return <Badge>memory mode</Badge>;
  if (ok === undefined) return <Badge>—</Badge>;
  return <Badge tone={ok ? "up" : "down"}><Database className="size-3" /> {ok ? "connected" : "error"}</Badge>;
}

export { Panel };
