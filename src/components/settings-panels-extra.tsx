"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSettings } from "@/lib/settings";
import { Button, Panel } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { OrcaMark } from "@/components/logo";
import { fmtNum } from "@/components/ui";
import { Copy, LogIn, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";

/* ------------------------------- primitives ------------------------------- */

export function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Panel className="mb-3" pad={false}>
      <header className="border-b border-border-subtle px-3.5 py-2.5">
        <h2 className="text-[13.5px] font-semibold text-text-primary">{title}</h2>
        {desc && <p className="mt-0.5 text-[11px] text-text-muted">{desc}</p>}
      </header>
      <div className="space-y-3 p-3.5">{children}</div>
    </Panel>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[12.5px] text-text-primary">{label}</div>
        {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Seg<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
}) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
          role="radio"
          aria-checked={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      className="switch"
      data-on={on}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
    />
  );
}

export function SavedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-[11px] text-positive">Đã lưu</span>;
}

/* --------------------------------- PROFILE -------------------------------- */

const TIMEZONES = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "UTC",
];

function ProfileAvatar({
  size = 64,
  displayName,
}: {
  size?: number;
  displayName: string;
}) {
  const { settings } = useSettings();
  const initials = (displayName || "OR").slice(0, 2).toUpperCase();

  if (settings.profile.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={settings.profile.avatarUrl}
        alt="Avatar"
        className="size-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  if (settings.profile.avatarStyle === "orca") {
    return <OrcaMark size={Math.round(size * 0.75)} className="rounded-lg" />;
  }
  const bg =
    settings.profile.avatarStyle === "initials-ocean"
      ? "bg-gradient-to-br from-accent-primary to-accent-2"
      : settings.profile.avatarStyle === "initials-amber"
        ? "bg-gradient-to-br from-warn to-warning"
        : "bg-surface-modal text-text-primary";
  return (
    <span
      className={`grid size-full place-items-center font-bold text-white ${bg}`}
      style={{ fontSize: Math.max(12, size * 0.28) }}
    >
      {initials}
    </span>
  );
}

function avatarPresetClass(style: string, cls: string | null, active: boolean) {
  const base =
    "grid size-9 place-items-center overflow-hidden rounded-lg border-2 transition-all";
  const state = active
    ? "border-accent-primary"
    : "border-transparent opacity-70 hover:opacity-100";
  return `${base} ${state} ${cls ?? ""}`;
}

export function ProfileTab({ onOpenSecurity }: { onOpenSecurity?: () => void }) {
  const { settings, update } = useSettings();
  const { data: me, mutate } = useApi<{ user: { id: string; email: string; name: string | null } }>(
    "/api/v1/auth/me",
  );
  const [name, setName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setName(settings.profile.displayName || me?.user?.name || "");
  }, [settings.profile.displayName, me?.user?.name, dirty]);

  const displayName = name;
  const email = me?.user?.email ?? null;
  const loggedIn = Boolean(me?.user);

  const saveName = async () => {
    setSaving(true);
    try {
      update({ profile: { ...settings.profile, displayName: name.trim() } });
      if (me?.user) {
        await fetch("/api/v1/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        });
        await mutate();
      }
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
    } finally {
      setSaving(false);
    }
  };

  const copyEmail = async () => {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <Panel className="mb-3 overflow-hidden" pad={false}>
        <div className="relative px-4 py-5 sm:px-5">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                "radial-gradient(ellipse 80% 60% at 10% 0%, color-mix(in srgb, var(--color-accent-primary) 22%, transparent), transparent 55%)",
            }}
          />
          <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3.5">
              <div className="grid size-[72px] shrink-0 place-items-center overflow-hidden rounded-2xl border border-border-subtle bg-surface-elevated shadow-sm">
                <ProfileAvatar size={72} displayName={displayName} />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[17px] font-semibold tracking-tight text-text-primary">
                  {displayName.trim() || "Người dùng ORCA"}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-muted">
                  {email ? (
                    <button
                      type="button"
                      onClick={() => void copyEmail()}
                      className="inline-flex items-center gap-1 hover:text-text-primary"
                      title="Sao chép email"
                    >
                      {email}
                      <Copy className="size-3 opacity-70" />
                      {copied ? <span className="text-[10px] text-positive">Đã chép</span> : null}
                    </button>
                  ) : (
                    <span>Chưa đăng nhập</span>
                  )}
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span
                    className={
                      loggedIn
                        ? "inline-flex items-center gap-1 rounded-full border border-up/30 bg-up/10 px-2 py-0.5 text-[10.5px] font-medium text-up"
                        : "inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-elevated px-2 py-0.5 text-[10.5px] font-medium text-text-muted"
                    }
                  >
                    <span className={loggedIn ? "size-1.5 rounded-full bg-up" : "size-1.5 rounded-full bg-text-muted"} />
                    {loggedIn ? "Đã đăng nhập" : "Khách"}
                  </span>
                  <span className="rounded-full border border-border-subtle bg-surface-elevated px-2 py-0.5 text-[10.5px] text-text-muted">
                    {settings.profile.region === "vn" ? "Việt Nam" : "Toàn cầu"}
                  </span>
                  <span className="rounded-full border border-border-subtle bg-surface-elevated px-2 py-0.5 text-[10.5px] text-text-muted">
                    {settings.profile.timezone.replace(/_/g, " ")}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              {loggedIn ? (
                <Button type="button" variant="secondary" size="sm" onClick={onOpenSecurity}>
                  <ShieldCheck className="size-3.5" />
                  Bảo mật
                </Button>
              ) : (
                <Link
                  href="/login"
                  className="orca-btn orca-btn-primary orca-btn-sm inline-flex items-center gap-1.5"
                >
                  <LogIn className="size-3.5" />
                  Đăng nhập
                </Link>
              )}
            </div>
          </div>
        </div>
      </Panel>

      <Section title="Chỉnh sửa hồ sơ" desc="Tên hiển thị và ảnh đại diện dùng trên toàn hệ thống.">
        <Row label="Tên hiển thị" hint="Hiện trên sidebar và báo cáo khi đã lưu">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
              placeholder="Tên của bạn"
              className="input w-48"
              maxLength={64}
            />
            <Button
              type="button"
              size="sm"
              loading={saving}
              disabled={!dirty && !saving}
              onClick={() => void saveName()}
            >
              Lưu
            </Button>
            <SavedNote show={saved} />
          </div>
        </Row>

        {email ? (
          <Row label="Email" hint="Không thể đổi tại đây — liên hệ hỗ trợ nếu cần">
            <span className="text-[12.5px] text-text-secondary">{email}</span>
          </Row>
        ) : (
          <Row label="Email" hint="Đăng nhập để đồng bộ hồ sơ giữa thiết bị">
            <Link href="/login" className="text-[12.5px] font-medium text-accent-primary hover:underline">
              Đăng nhập ngay
            </Link>
          </Row>
        )}

        <div className="space-y-3 border-t border-border-subtle pt-3">
          <div className="text-[12.5px] font-medium text-text-primary">Ảnh đại diện</div>
          <p className="text-[11px] text-text-muted">
            Chọn phong cách sẵn có hoặc tải ảnh (tự crop vuông 160px). Ảnh tùy chỉnh đồng bộ khi đã
            đăng nhập.
          </p>
          <div className="flex flex-wrap items-start gap-4">
            <div className="grid size-16 place-items-center overflow-hidden rounded-xl border border-border-subtle bg-surface-elevated">
              <ProfileAvatar size={64} displayName={displayName} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ["orca", null],
                    ["initials-ocean", "bg-gradient-to-br from-accent-primary to-accent-2"],
                    ["initials-slate", "bg-surface-modal"],
                    ["initials-amber", "bg-gradient-to-br from-warn to-warning"],
                  ] as const
                ).map(([style, cls]) => {
                  const active =
                    !settings.profile.avatarUrl && settings.profile.avatarStyle === style;
                  return (
                    <button
                      key={style}
                      type="button"
                      onClick={() =>
                        update({
                          profile: {
                            ...settings.profile,
                            avatarStyle: style,
                            avatarUrl: null,
                          },
                        })
                      }
                      aria-label={`Avatar ${style}`}
                      className={avatarPresetClass(style, cls, active)}
                    >
                      {style === "orca" ? (
                        <OrcaMark size={34} className="rounded-lg" />
                      ) : (
                        <span className="text-[10px] font-bold text-white">
                          {(displayName || "OR").slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="cursor-pointer rounded-md border border-border-subtle bg-surface-elevated px-2.5 py-1.5 text-[12px] font-medium text-text-primary hover:border-accent-primary">
                  Tải ảnh lên
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      if (file.size > 4 * 1024 * 1024) {
                        alert("Ảnh tối đa 4MB. Hãy chọn ảnh nhỏ hơn.");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = String(reader.result || "");
                        const img = new Image();
                        img.onload = () => {
                          const size = 160;
                          const canvas = document.createElement("canvas");
                          canvas.width = size;
                          canvas.height = size;
                          const ctx = canvas.getContext("2d");
                          if (!ctx) return;
                          const min = Math.min(img.width, img.height);
                          const sx = (img.width - min) / 2;
                          const sy = (img.height - min) / 2;
                          ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
                          const out = canvas.toDataURL("image/jpeg", 0.85);
                          update({
                            profile: {
                              ...settings.profile,
                              avatarStyle: "custom",
                              avatarUrl: out,
                            },
                          });
                        };
                        img.src = dataUrl;
                      };
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                {settings.profile.avatarUrl ? (
                  <button
                    type="button"
                    className="rounded-md px-2.5 py-1.5 text-[12px] text-text-muted hover:text-negative"
                    onClick={() =>
                      update({
                        profile: {
                          ...settings.profile,
                          avatarUrl: null,
                          avatarStyle: "orca",
                        },
                      })
                    }
                  >
                    Xóa ảnh
                  </button>
                ) : null}
              </div>
              <p className="text-[10.5px] text-text-muted">
                {loggedIn
                  ? "Đã đăng nhập — avatar lưu local và đồng bộ settings server."
                  : "Đăng nhập để đồng bộ avatar giữa các thiết bị."}
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Ngôn ngữ & khu vực" desc="Múi giờ áp dụng cho đồng hồ và mọi timestamp hiển thị.">
        <Row label="Ngôn ngữ giao diện">
          <Seg
            value={settings.profile.language}
            onChange={(v) => update({ profile: { ...settings.profile, language: v } })}
            options={[
              { value: "vi", label: "Tiếng Việt" },
              { value: "en", label: "English" },
            ]}
          />
        </Row>
        <Row label="Múi giờ">
          <select
            value={settings.profile.timezone}
            onChange={(e) => update({ profile: { ...settings.profile, timezone: e.target.value } })}
            className="input w-48"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </Row>
        <Row label="Khu vực ưu tiên" hint="Ảnh hưởng thứ tự gợi ý tài sản">
          <Seg
            value={settings.profile.region}
            onChange={(v) => update({ profile: { ...settings.profile, region: v } })}
            options={[
              { value: "vn", label: "Việt Nam" },
              { value: "global", label: "Toàn cầu" },
            ]}
          />
        </Row>
      </Section>
    </>
  );
}

/* -------------------------------- APPEARANCE ------------------------------- */

export function AppearanceTab() {
  const { settings, update } = useSettings();
  const a = settings.appearance;
  return (
    <>
      <Section title="Giao diện" desc="Deep Navy Professional là theme mặc định của ORCA Financial.">
        <Row label="Chế độ hiển thị">
          <Seg
            value={a.mode}
            onChange={(v) => update({ appearance: { ...a, mode: v } })}
            options={[
              {
                value: "navy",
                label: (
                  <span className="flex items-center gap-1">
                    <Moon className="size-3" /> Navy
                  </span>
                ),
              },
              {
                value: "light",
                label: (
                  <span className="flex items-center gap-1">
                    <Sun className="size-3" /> Light
                  </span>
                ),
              },
              {
                value: "system",
                label: (
                  <span className="flex items-center gap-1">
                    <Monitor className="size-3" /> System
                  </span>
                ),
              },
            ]}
          />
        </Row>
        <Row label="Mật độ hiển thị" hint="Compact phù hợp màn hình dữ liệu dày đặc">
          <Seg
            value={a.density}
            onChange={(v) => update({ appearance: { ...a, density: v } })}
            options={[
              { value: "compact", label: "Compact" },
              { value: "normal", label: "Normal" },
              { value: "comfortable", label: "Comfortable" },
            ]}
          />
        </Row>
        <Row label="Cỡ chữ">
          <Seg
            value={a.fontSize}
            onChange={(v) => update({ appearance: { ...a, fontSize: v } })}
            options={[
              { value: "sm", label: "S" },
              { value: "md", label: "M" },
              { value: "lg", label: "L" },
            ]}
          />
        </Row>
        <Row
          label="Giảm hiệu ứng chuyển động"
          hint="Tắt animation — tự động khi hệ điều hành bật reduced motion"
        >
          <Switch
            on={settings.accessibility.reducedMotion}
            onChange={(v) =>
              update({ accessibility: { ...settings.accessibility, reducedMotion: v } })
            }
            label="Reduced motion"
          />
        </Row>
        <Row label="Định dạng số">
          <Seg
            value={a.numberFormat}
            onChange={(v) => update({ appearance: { ...a, numberFormat: v } })}
            options={[
              { value: "en-US", label: "1,234.56" },
              { value: "vi-VN", label: "1.234,56" },
            ]}
          />
        </Row>
        <Row label="Đơn vị tiền" hint="Quy đổi khối lượng/giá trị theo tỷ giá USD/VND">
          <Seg
            value={a.currency}
            onChange={(v) => update({ appearance: { ...a, currency: v } })}
            options={[
              { value: "USD", label: "USD $" },
              { value: "VND", label: "VND ₫" },
            ]}
          />
        </Row>
        <div className="panel-inset p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">Xem trước</div>
          <div className="num text-[15px] text-text-primary">
            {fmtNum(1234567.891, 2)} <span className="text-text-muted">USD</span>
          </div>
          <div className="text-[11px] text-text-muted">
            <span className="text-positive">+2.48%</span> ·{" "}
            <span className="text-negative">-1.63%</span> ·{" "}
            {new Date().toLocaleDateString(settings.profile.language)}
          </div>
        </div>
      </Section>
    </>
  );
}
