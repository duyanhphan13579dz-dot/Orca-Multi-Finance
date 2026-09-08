"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { LogIn } from "lucide-react";
import type { ApiResponse } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");
  // Chặn open-redirect: chỉ cho internal path
  const safeNext = nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = (await res.json()) as ApiResponse<unknown>;
      if (!json.success) {
        setError(json.error.message);
      } else {
        router.push(safeNext);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  const registerHref = safeNext !== "/" ? `/register?next=${encodeURIComponent(safeNext)}` : "/register";

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <div className="panel p-6">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><LogIn className="size-5 text-accent" /> Đăng nhập ORCA</h1>
        <p className="mt-1 text-[12px] text-ink-3">Phiên JWT httpOnly — khóa API và bí mật chỉ nằm phía server.</p>
        {safeNext !== "/" && (
          <p className="mt-2 rounded-md bg-accent/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-accent">
            Đăng nhập để tiếp tục: <span className="font-medium">{safeNext}</span>
          </p>
        )}
        <form onSubmit={submit} className="mt-4 space-y-3">
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email"
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink focus:border-accent/40" />
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mật khẩu"
            className="w-full rounded-md border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink focus:border-accent/40" />
          {error && <p className="text-[12px] text-down">{error}</p>}
          <button disabled={busy} className="w-full rounded-md bg-accent/90 py-2 text-[13px] font-semibold text-canvas hover:bg-accent disabled:opacity-50">
            {busy ? "Đang xác thực…" : "Đăng nhập"}
          </button>
        </form>
        <p className="mt-3 text-center text-[12px] text-ink-3">
          Chưa có tài khoản? <Link href={registerHref} className="text-accent hover:underline">Đăng ký</Link>
        </p>
      </div>
    </div>
  );
}
