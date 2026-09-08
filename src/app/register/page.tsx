"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import type { ApiResponse } from "@/lib/types";

export default function RegisterPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || undefined, email, password }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) setError(json.error.message);
      else {
        router.push(safeNext);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const loginHref = safeNext !== "/" ? `/login?next=${encodeURIComponent(safeNext)}` : "/login";

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="panel p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><UserPlus className="size-5 text-accent" /> Tạo tài khoản</h1>
        <p className="mt-1 text-[12px] text-ink-3">Mật khẩu được băm scrypt phía server; tối thiểu 8 ký tự.</p>
        {safeNext !== "/" && (
          <p className="mt-2 rounded-md bg-accent/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-accent">
            Tạo tài khoản để tiếp tục: <span className="font-medium">{safeNext}</span>
          </p>
        )}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên hiển thị (tuỳ chọn)"
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink focus:border-accent/40" />
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink focus:border-accent/40" />
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu (≥8 ký tự)"
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink focus:border-accent/40" />
          {error && <p className="text-[12px] text-down">{error}</p>}
          <button disabled={busy} className="w-full rounded-md bg-accent/90 py-2 text-[13px] font-semibold text-canvas hover:bg-accent disabled:opacity-50">
            {busy ? "Đang tạo…" : "Đăng ký"}
          </button>
        </form>
        <p className="mt-3 text-center text-[12px] text-ink-3">
          Đã có tài khoản? <Link href={loginHref} className="text-accent hover:underline">Đăng nhập</Link>
        </p>
      </div>
    </div>
  );
}
