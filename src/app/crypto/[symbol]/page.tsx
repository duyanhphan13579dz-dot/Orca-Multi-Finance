import { CryptoDetailPage } from "@/components/crypto-detail";

export const metadata = { title: "Crypto detail" };

export default async function Page({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  return <CryptoDetailPage symbol={symbol.toUpperCase()} />;
}
