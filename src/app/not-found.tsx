import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[min(60dvh,520px)] w-full flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">ORCA Financial</p>
      <h1 className="text-[44px] font-bold leading-none tracking-tight text-text-primary">404</h1>
      <p className="max-w-sm text-[13.5px] text-text-secondary">
        Trang bạn tìm không tồn tại hoặc đã được di chuyển.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Link
          href="/"
          className="rounded-md bg-accent-primary px-3.5 py-2 text-[12.5px] font-semibold text-white"
        >
          Về trang chủ
        </Link>
        <Link
          href="/stocks"
          className="rounded-md border border-border-subtle bg-surface-elevated px-3.5 py-2 text-[12.5px] font-medium text-text-primary"
        >
          Cổ phiếu VN
        </Link>
      </div>
    </div>
  );
}
