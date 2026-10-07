/**
 * Asset type registry — bridge nhật ký giao dịch ↔ Data Hub ↔ phân tích danh mục.
 *
 * Khi nhật ký thêm loại tài sản mới: đăng ký handler mark tại đây;
 * hubPortfolioMarks + journal-analysis + portfolio page tự nhận biết.
 */

export type HubAssetType = "stock" | "crypto" | "forex" | "commodity";

export type AssetTypeDef = {
  id: HubAssetType;
  /** Nhãn UI tiếng Việt */
  labelVi: string;
  /** Giới hạn số mã mark song song mỗi request (timeout hub) */
  markBudget: number;
  /** Gợi ý nhận diện từ symbol khi user quên chọn loại */
  infer?: (symbol: string) => boolean;
};

export const ASSET_TYPE_REGISTRY: readonly AssetTypeDef[] = [
  {
    id: "stock",
    labelVi: "Cổ phiếu",
    markBudget: 40,
    infer: (s) => /^[A-Z]{3}$/.test(s) && !/USDT|USD|EUR|JPY|GBP|CNY|XAU|XAG|WTI|GOLD|BTC|ETH/.test(s),
  },
  {
    id: "crypto",
    labelVi: "Crypto",
    markBudget: 10,
    infer: (s) => /USDT$/.test(s) || /^(BTC|ETH|BNB|SOL|XRP|ADA|DOGE|TON|PEPE|ARB|OP)$/.test(s),
  },
  {
    id: "forex",
    labelVi: "Forex",
    markBudget: 12,
    infer: (s) => {
      const n = s.replace(/[\/\s]/g, "");
      return n.length === 6 && /^[A-Z]{6}$/.test(n) && !n.endsWith("USDT");
    },
  },
  {
    id: "commodity",
    labelVi: "Hàng hóa",
    markBudget: 12,
    infer: (s) => /^(XAU|XAG|GOLD|SILVER|WTI|BRENT|OIL|COPPER|NGAS|NICKEL|GAS)$/.test(s),
  },
] as const;

const BY_ID = new Map(ASSET_TYPE_REGISTRY.map((d) => [d.id, d]));

export function listAssetTypes(): readonly AssetTypeDef[] {
  return ASSET_TYPE_REGISTRY;
}

export function getAssetTypeDef(id: string): AssetTypeDef | undefined {
  return BY_ID.get(id as HubAssetType);
}

export function isKnownAssetType(id: string): id is HubAssetType {
  return BY_ID.has(id as HubAssetType);
}

/**
 * Chuẩn hoá loại tài sản từ nhật ký.
 * Ưu tiên giá trị user chọn; nếu lạ / trống → suy luận từ symbol.
 */
export function normalizeAssetType(
  declared: string | null | undefined,
  symbol: string,
): HubAssetType {
  const d = String(declared ?? "")
    .trim()
    .toLowerCase();
  if (isKnownAssetType(d)) return d;
  // aliases
  if (d === "vn" || d === "vnstock" || d === "cophieu" || d === "cổ phiếu") return "stock";
  if (d === "fx" || d === "currency") return "forex";
  if (d === "cmdty" || d === "goods" || d === "hanghoa") return "commodity";
  if (d === "coin" || d === "token") return "crypto";

  const sym = String(symbol ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\/\s]/g, "");
  for (const def of ASSET_TYPE_REGISTRY) {
    if (def.infer?.(sym)) return def.id;
  }
  return "stock";
}

export function formatAssetTypeVi(id: string): string {
  return getAssetTypeDef(id)?.labelVi ?? id;
}

/** Group positions by resolved asset type for batched hub fetches. */
export function groupByAssetType<T extends { assetType?: string; symbol: string }>(
  positions: T[],
): Record<HubAssetType, T[]> {
  const out: Record<HubAssetType, T[]> = {
    stock: [],
    crypto: [],
    forex: [],
    commodity: [],
  };
  for (const p of positions) {
    const t = normalizeAssetType(p.assetType, p.symbol);
    out[t].push(p);
  }
  return out;
}
