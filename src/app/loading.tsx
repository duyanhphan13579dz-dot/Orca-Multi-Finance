import { OrcaWordmark } from "@/components/logo";

export default function RootLoading() {
  return (
    <div className="grid min-h-[60dvh] place-items-center">
      <div className="flex flex-col items-center gap-4">
        <OrcaWordmark size={48} />
        <div className="flex items-center gap-2 text-[12px] text-text-muted">
          <span className="size-1.5 animate-pulse rounded-full bg-accent-primary" />
          Đang tải dữ liệu thị trường…
        </div>
      </div>
    </div>
  );
}
