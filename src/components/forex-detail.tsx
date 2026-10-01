"use client";

/** Temporary marker — full institutional cockpit landing next commits */
export function ForexDetailPage({ pair }: { pair: string }) {
  return (
    <div className="panel p-4 text-sm text-text-secondary">
      Forex terminal upgrade in progress for {pair}. Reload after next deploy.
    </div>
  );
}
