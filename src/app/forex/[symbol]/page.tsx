import { ForexDetailPage } from "@/components/forex-detail";

export const metadata = { title: "Forex detail" };

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <ForexDetailPage pair={symbol.toUpperCase().replace(/[^A-Z]/g, "")} />;
}
