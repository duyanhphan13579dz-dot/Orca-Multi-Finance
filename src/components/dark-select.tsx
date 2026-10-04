"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

export type DarkSelectOption = { value: string; label: string };

/**
 * Theme-aware listbox. Native <select>/<option> often forces a light OS menu
 * on dark UIs; this keeps the popover on the app surface tokens.
 */
export function DarkSelect({
  value,
  onChange,
  options,
  className = "",
  buttonClassName = "",
  placeholder,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: DarkSelectOption[];
  className?: string;
  buttonClassName?: string;
  placeholder?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label =
    options.find((o) => o.value === value)?.label ??
    placeholder ??
    options[0]?.label ??
    "—";

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`input flex w-full items-center justify-between gap-1.5 !py-1.5 text-left text-[12px] shadow-[0_2px_10px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.04)] ${buttonClassName}`}
      >
        <span className="truncate text-text-primary">{label}</span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-border-default bg-[var(--color-surface-modal)] py-1 shadow-[0_12px_28px_rgba(0,0,0,0.55),0_0_0_1px_rgba(255,255,255,0.04)]"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                  className={`flex w-full px-2.5 py-1.5 text-left text-[12px] transition-colors ${
                    active
                      ? "bg-accent-primary/20 font-medium text-accent-primary"
                      : "text-text-primary hover:bg-surface-elevated"
                  }`}
                >
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
