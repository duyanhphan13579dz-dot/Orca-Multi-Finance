"use client";

import { useState } from "react";
import { useSettings } from "@/lib/settings";
import { Panel } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { OrcaMark } from "@/components/logo";
import { fmtNum } from "@/components/ui";
import { Monitor, Moon, Sun } from "lucide-react";

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

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[] }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} data-active={value === o.value} onClick={() => onChange(o.value)} role="radio" aria-checked={value === o.value}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button className="switch" data-on={on} onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label} />
  );
}

export function SavedNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <span className="text-[11px] text-positive">Đã lưu</span>;
}

/* --------------------------------- PROFILE -------------------------------- */

const TIMEZONES = [
  "Asia/Ho_Chi_Minh", "Asia/Bangkok", "Asia/Singapore", "Asia/Tokyo", "Asia/Seoul",
  "Australia/Sydney", "Europe/London", "Europe/Berlin", "America/New_York", "America/Chicago",
  "America/Los_Angeles", "UTC",
];

export function ProfileTab() {
  const { settings, update } = useSettings();
  const { data: me, mutate } = useApi<{ user: { id: string; email: string; name: string | null } }>("/api/v1/auth/me");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);

  const effectiveName = name || settings.profile.displayName || me?.user?.name || "";

  const saveName = async () => {
    update({ profile: { ...settings.profile, displayName: effectiveName } });
    if (me?.user) {
      await fetch("/api/v1/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: effectiveName }),
      });
      await mutate();
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <>
      <Section title="Thông tin tài khoản" desc="Tên hiển thị, avatar và tuỳ chọn khu vực.">
        <Row label="Tên hiển thị" hint={me?.user ? me.user.email : "Đăng nhập để đồng bộ tài khoản giữa các thiết bị"}>
          <div className="flex items-center gap-2">
            <input value={effectiveName} onChange={(e) => setName(e.target.value)} placeholder="Tên của bạn" className="input w-44" />
            <button onClick={saveName} className="rounded-md bg-accent-primary px-2.5 py-1.5 text-[12px] font-semibold text-white">Lưu</button>
            <SavedNote show={saved} />
          </div>
        </Row>
        <Row label="Avatar" hint="Phong cách hiển thị ở góc phải header">
          <div className="flex gap-1.5">
            {(
              [
                ["orca", null],
                ["initials-ocean", "bg-gradient-to-br from-accent-primary to-accent-2"],
                ["initials-slate", "bg-surface-modal"],
                ["initials-amber", "bg-gradient-to-br from-warn to-warning"],
              ] as const
            ).map(([style, cls]) => (
              <button
                key={style}
                onClick={() => update({ profile: { ...settings.profile, avatarStyle: style } })}
                aria-label={`Avatar ${style}`}
                className={`grid size-9 place-items-center overflow-hidden rounded-lg border-2 transition-all ${
                  settings.profile.avatarStyle === style ? "border-accent-primary" : "border-transparent opacity-70 hover:opacity-100"
                } ${cls ?? ""}`}
              >
                {style === "orca" ? <OrcaMark size={34} className="rounded-lg" /> : <span className="text-[10px] font-bold text-white">{effectiveName.slice(0, 2).toUpperCase() || "OR"}</span>}
              </button>
            ))}
          </div>
        </Row>
      </Section>
      <Section title="Ngôn ngữ & Khu vực" desc="Múi giờ áp dụng cho đồng hồ và mọi timestamp hiển thị.">
        <Row label="Ngôn ngữ giao diện">
          <Seg value={settings.profile.language} onChange={(v) => update({ profile: { ...settings.profile, language: v } })}
            options={[{ value: "vi", label: "Tiếng Việt" }, { value: "en", label: "English" }]} />
        </Row>
        <Row label="Múi giờ">
          <select value={settings.profile.timezone} onChange={(e) => update({ profile: { ...settings.profile, timezone: e.target.value } })} className="input w-48">
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Row>
        <Row label="Khu vực ưu tiên" hint="Ảnh hưởng thứ tự gợi ý tài sản">
          <Seg value={settings.profile.region} onChange={(v) => update({ profile: { ...settings.profile, region: v } })}
            options={[{ value: "vn", label: "Việt Nam" }, { value: "global", label: "Toàn cầu" }]} />
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
      <Section title="Theme" desc="Deep Navy Professional là theme mặc định của ORCA Financial.">
        <Row label="Chế độ hiển thị">
          <Seg value={a.mode} onChange={(v) => update({ appearance: { ...a, mode: v } })}
            options={[
              { value: "navy", label: <span className="flex items-center gap-1"><Moon className="size-3" /> Navy</span> },
              { value: "light", label: <span className="flex items-center gap-1"><Sun className="size-3" /> Light</span> },
              { value: "system", label: <span className="flex items-center gap-1"><Monitor className="size-3" /> System</span> },
            ]} />
        </Row>
        <Row label="Mật độ hiển thị (density)" hint="Compact phù hợp màn hình dữ liệu dày đặc">
          <Seg value={a.density} onChange={(v) => update({ appearance: { ...a, density: v } })}
            options={[{ value: "compact", label: "Compact" }, { value: "normal", label: "Normal" }, { value: "comfortable", label: "Comfortable" }]} />
        </Row>
        <Row label="Cỡ chữ">
          <Seg value={a.fontSize} onChange={(v) => update({ appearance: { ...a, fontSize: v } })}
            options={[{ value: "sm", label: "Nhỏ" }, { value: "md", label: "Vừa" }, { value: "lg", label: "Lớn" }]} />
        </Row>
      </Section>
      <Section title="Định dạng số & tiền tệ" desc="Áp dụng toàn cục cho mọi bảng giá và chỉ số.">
        <Row label="Định dạng số" hint={a.numberFormat === "vi-VN" ? "1.234.567,89" : "1,234,567.89"}>
          <Seg value={a.numberFormat} onChange={(v) => update({ appearance: { ...a, numberFormat: v } })}
            options={[{ value: "en-US", label: "1,234,567.89" }, { value: "vi-VN", label: "1.234.567,89" }]} />
        </Row>
        <Row label="Tiền tệ hiển thị quy đổi" hint="Quy đổi khối lượng/giá trị USD → ₫ theo tỷ giá USD/VND realtime">
          <Seg value={a.currency} onChange={(v) => update({ appearance: { ...a, currency: v } })}
            options={[{ value: "USD", label: "USD $" }, { value: "VND", label: "VND ₫" }]} />
        </Row>
        <div className="panel-inset p-3">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">Xem trước</div>
          <div className="num text-[15px] text-text-primary">{fmtNum(1234567.891, 2)} <span className="text-text-muted">USD</span></div>
          <div className="text-[11px] text-text-muted">
            <span className="text-positive">+2.48%</span> · <span className="text-negative">-1.63%</span> · {new Date().toLocaleDateString(settings.profile.language)}
          </div>
        </div>
      </Section>
    </>
  );
}
