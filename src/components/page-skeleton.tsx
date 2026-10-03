/**
 * Route-level loading skeletons for Next.js `loading.tsx`.
 * Shown while the segment is suspending / page chunk is loading.
 */

type Variant = "dashboard" | "table" | "detail" | "content" | "form";

function Shimmer({ className = "" }: { className?: string }) {
  return <div className={`orca-skeleton ${className}`} />;
}

export function PageSkeleton({
  variant = "dashboard",
  title,
}: {
  variant?: Variant;
  title?: string;
}) {
  return (
    <div
      className="orca-page-loading flex min-h-[42dvh] flex-col gap-3"
      aria-busy="true"
      aria-label="Đang tải trang"
    >
      <div className="flex items-center gap-3">
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-border-subtle">
          <div className="orca-skeleton-bar h-full w-2/5 rounded-full" />
        </div>
        {title ? (
          <span className="shrink-0 text-[11px] font-medium text-text-muted">{title}</span>
        ) : null}
      </div>

      {variant === "dashboard" && <DashboardSkeleton />}
      {variant === "table" && <TableSkeleton />}
      {variant === "detail" && <DetailSkeleton />}
      {variant === "content" && <ContentSkeleton />}
      {variant === "form" && <FormSkeleton />}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Shimmer key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Shimmer className="h-56 rounded-xl lg:col-span-2" />
        <Shimmer className="h-56 rounded-xl" />
      </div>
      <Shimmer className="h-40 rounded-xl" />
    </>
  );
}

function TableSkeleton() {
  const widths = ["w-3/5", "w-2/3", "w-1/2", "w-4/5", "w-3/5", "w-2/3", "w-1/2", "w-3/4"];
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Shimmer className="h-9 w-40 rounded-lg" />
        <Shimmer className="h-9 w-28 rounded-lg" />
        <Shimmer className="ml-auto h-9 w-32 rounded-lg" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border-subtle">
        <Shimmer className="h-10 rounded-none" />
        {widths.map((w, i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-t border-border-subtle/70 px-3 py-2.5"
          >
            <Shimmer className="size-8 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <Shimmer className={`h-4 rounded ${w}`} />
            </div>
            <Shimmer className="h-4 w-16 rounded" />
            <Shimmer className="h-4 w-14 rounded" />
          </div>
        ))}
      </div>
    </>
  );
}

function DetailSkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-2">
          <Shimmer className="h-5 w-24 rounded" />
          <Shimmer className="h-9 w-40 rounded-lg" />
        </div>
        <Shimmer className="h-8 w-20 rounded-lg" />
        <Shimmer className="h-8 w-16 rounded-lg" />
        <div className="ml-auto flex gap-2">
          <Shimmer className="h-8 w-24 rounded-lg" />
          <Shimmer className="h-8 w-24 rounded-lg" />
        </div>
      </div>
      <Shimmer className="h-[320px] rounded-xl" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Shimmer className="h-48 rounded-xl" />
        <Shimmer className="h-48 rounded-xl" />
      </div>
    </>
  );
}

function ContentSkeleton() {
  return (
    <>
      <Shimmer className="h-9 w-56 rounded-lg" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-xl border border-border-subtle p-3">
            <Shimmer className="h-28 rounded-lg" />
            <Shimmer className="h-4 w-4/5 rounded" />
            <Shimmer className="h-3 w-2/3 rounded" />
          </div>
        ))}
      </div>
    </>
  );
}

function FormSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
      <Shimmer className="h-8 w-40 rounded-lg" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <Shimmer className="h-3 w-24 rounded" />
          <Shimmer className="h-10 w-full rounded-lg" />
        </div>
      ))}
      <Shimmer className="h-10 w-32 rounded-lg" />
    </div>
  );
}
