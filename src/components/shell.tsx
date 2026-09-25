"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { Settings } from "lucide-react";
import { NotifBell } from "@/components/notif-bell";
import { TickerTape } from "@/components/ticker-tape";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background-primary text-text-primary">
      <div className="border-b border-border-subtle">
        <TickerTape />
      </div>
      <header className="flex h-12 items-center gap-2 border-b border-border-subtle px-3">
        <Link href="/" className="font-semibold text-accent-primary">
          Orca
        </Link>
        <div className="flex-1" />
        <NotifBell />
        <Link
          href="/settings"
          className="grid size-9 place-items-center rounded-lg text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
          aria-label="Settings"
        >
          <Settings className="size-4" />
        </Link>
      </header>
      <div className="flex flex-1">
        <nav className="hidden w-48 shrink-0 border-r border-border-subtle p-2 md:block">
          <NavLink href="/">Tong quan</NavLink>
          <NavLink href="/stocks">Co phieu</NavLink>
          <NavLink href="/journal">Nhat ky / Alert</NavLink>
          <NavLink href="/reports">Ban tin</NavLink>
          <NavLink href="/news">Tin tuc</NavLink>
          <NavLink href="/settings">Cai dat</NavLink>
        </nav>
        <main className="min-w-0 flex-1 p-3 sm:p-4">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="block rounded-md px-2.5 py-1.5 text-[13px] text-text-secondary hover:bg-surface-elevated hover:text-text-primary"
    >
      {children}
    </Link>
  );
}
