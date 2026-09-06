import { MetalsDetailPage } from "@/components/metals-detail";

export const metadata = { title: "Kim loại detail" };

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <MetalsDetailPage symbol={symbol.toUpperCase().replace(/[^A-Z]/g, "")} />;
}
