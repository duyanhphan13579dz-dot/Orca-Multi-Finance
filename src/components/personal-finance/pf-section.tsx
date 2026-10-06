"use client";

import Link from "next/link";
import { Panel } from "@/components/ui";

export function PfSection({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-3 sm:p-4">
      <header>
        <Link href="/pf" className="text-[11px] text-accent underline">
          ← Tổng quan PF
        </Link>
        <h1 className="mt-1 text-[17px] font-semibold text-text-primary">{title}</h1>
        <p className="mt-0.5 text-[11.5px] text-text-muted">{desc}</p>
      </header>
      <Panel className="p-4">
        {children ?? (
          <p className="text-[12px] text-text-muted">
            Module đang được port từ Orca Wallet (engines đã có trong{" "}
            <code className="text-[11px]">src/lib/personal-finance</code>). UI đầy đủ (wizard /
            charts) sẽ hoàn thiện ở phase tiếp theo.
          </p>
        )}
      </Panel>
    </div>
  );
}
