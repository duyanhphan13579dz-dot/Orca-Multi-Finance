"use client";

import { BrandLoading } from "@/components/ui";

type Variant = "dashboard" | "table" | "detail" | "content" | "form";

/**
 * Route-level loading — full-frame centered ORCA brand.
 * Modal / landing overlays keep their own loaders.
 */
export function PageSkeleton({
  title,
}: {
  variant?: Variant;
  title?: string;
}) {
  return <BrandLoading size="lg" title={title} full />;
}
