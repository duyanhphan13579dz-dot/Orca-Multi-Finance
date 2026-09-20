export default function RootLoading() {
  return (
    <div className="flex min-h-[40dvh] flex-col gap-3 px-1 pt-1">
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-border-subtle">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent-primary/70" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="h-28 animate-pulse rounded-xl border border-border-subtle bg-surface-elevated/60" />
        <div className="h-28 animate-pulse rounded-xl border border-border-subtle bg-surface-elevated/40" />
        <div className="hidden h-28 animate-pulse rounded-xl border border-border-subtle bg-surface-elevated/30 lg:block" />
      </div>
      <div className="h-48 animate-pulse rounded-xl border border-border-subtle bg-surface-primary/80" />
    </div>
  );
}
