import "server-only";
import type { DerivativeContract, DerivativeProduct } from "../types";

/**
 * VSDC / HNX product specification — Contract Master seed (P0).
 * Specs from public VSDC product notices for VN30 / VN100 index futures and GB futures.
 * Multiplier: 100,000 VND × index points; tick: 0.1; cash settlement.
 * Continuous: VN30F1M, VN30F2M, VN30F1Q, VN30F2Q.
 */

export const VSDC = "vsdc-spec";
export const HNX = "hnx";

const HNX_DERIV_URL = "https://www.hnx.vn";

/** Third Thursday of a given month (UTC approx for Asia/Ho_Chi_Minh calendar). */
export function thirdThursdayOfMonth(year: number, monthIndex0: number): Date {
  const d = new Date(Date.UTC(year, monthIndex0, 1, 7, 0, 0));
  let thursdays = 0;
  while (d.getUTCMonth() === monthIndex0) {
    if (d.getUTCDay() === 4) {
      thursdays += 1;
      if (thursdays === 3) return new Date(d.getTime());
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return new Date(Date.UTC(year, monthIndex0, 15, 7, 0, 0));
}

function isoDate(d: Date): string {
  return d.toISOString();
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/** Next N monthly third-Thursdays starting near current month. */
export function nextExpiryDates(count: number, from = new Date()): Date[] {
  const out: Date[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() - 1;
  if (m < 0) {
    m = 11;
    y -= 1;
  }
  let guard = 0;
  while (out.length < count && guard < 36) {
    const exp = thirdThursdayOfMonth(y, m);
    if (exp.getTime() + 20 * 3_600_000 >= from.getTime()) out.push(exp);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
    guard += 1;
  }
  return out;
}

export const PRODUCT_CATALOG: DerivativeProduct[] = [
  {
    id: "VN30_INDEX_FUT",
    exchange: "HNX",
    underlying: "VN30",
    contractType: "INDEX_FUTURE",
    name: "Hợp đồng tương lai chỉ số VN30",
    nameEn: "VN30 Index Futures",
    multiplier: 100_000,
    tickSize: 0.1,
    currency: "VND",
    quoteUnit: "index_point",
    settlementType: "CASH",
    settlementMethod: "FINAL_SETTLEMENT_PRICE",
    source: VSDC,
    sourceUrl: HNX_DERIV_URL,
  },
  {
    id: "VN100_INDEX_FUT",
    exchange: "HNX",
    underlying: "VN100",
    contractType: "INDEX_FUTURE",
    name: "Hợp đồng tương lai chỉ số VN100",
    nameEn: "VN100 Index Futures",
    multiplier: 100_000,
    tickSize: 0.1,
    currency: "VND",
    quoteUnit: "index_point",
    settlementType: "CASH",
    settlementMethod: "FINAL_SETTLEMENT_PRICE",
    source: VSDC,
    sourceUrl: HNX_DERIV_URL,
  },
  {
    id: "GB05_BOND_FUT",
    exchange: "HNX",
    underlying: "GB05",
    contractType: "BOND_FUTURE",
    name: "HĐTL trái phiếu chính phủ 5 năm",
    nameEn: "5Y Government Bond Futures",
    multiplier: null,
    tickSize: null,
    currency: "VND",
    quoteUnit: "price",
    settlementType: "PHYSICAL",
    settlementMethod: null,
    source: VSDC,
    sourceUrl: HNX_DERIV_URL,
  },
  {
    id: "GB10_BOND_FUT",
    exchange: "HNX",
    underlying: "GB10",
    contractType: "BOND_FUTURE",
    name: "HĐTL trái phiếu chính phủ 10 năm",
    nameEn: "10Y Government Bond Futures",
    multiplier: null,
    tickSize: null,
    currency: "VND",
    quoteUnit: "price",
    settlementType: "PHYSICAL",
    settlementMethod: null,
    source: VSDC,
    sourceUrl: HNX_DERIV_URL,
  },
];

const VN30_ALIASES: { symbol: string; priority: number }[] = [
  { symbol: "VN30F1M", priority: 1 },
  { symbol: "VN30F2M", priority: 2 },
  { symbol: "VN30F1Q", priority: 3 },
  { symbol: "VN30F2Q", priority: 4 },
];

const VN100_ALIASES: { symbol: string; priority: number }[] = [
  { symbol: "VN100F1M", priority: 10 },
  { symbol: "VN100F2M", priority: 11 },
  { symbol: "VN100F1Q", priority: 12 },
];

export function buildContractMaster(now = new Date()): DerivativeContract[] {
  const retrievedAt = now.toISOString();
  const vn30Expiries = nextExpiryDates(6, now);
  const contracts: DerivativeContract[] = [];

  for (let i = 0; i < VN30_ALIASES.length; i++) {
    const a = VN30_ALIASES[i];
    const exp = vn30Expiries[i] ?? null;
    contracts.push({
      symbol: a.symbol,
      productId: "VN30_INDEX_FUT",
      exchange: "HNX",
      underlying: "VN30",
      contractCode: null,
      continuousAlias: a.symbol,
      listingDate: null,
      expiryDate: exp ? isoDate(exp) : null,
      lastTradeDate: exp ? isoDate(exp) : null,
      firstNoticeDate: null,
      initialMargin: null,
      maintenanceMargin: null,
      multiplier: 100_000,
      tickSize: 0.1,
      status: "ACTIVE",
      priority: a.priority,
      source: VSDC,
      sourceUrl: HNX_DERIV_URL,
      retrievedAt,
      effectiveFrom: retrievedAt,
      effectiveTo: null,
      daysToExpiry: exp ? daysBetween(now, exp) : null,
    });
  }

  const vn100Expiries = nextExpiryDates(3, now);
  for (let i = 0; i < VN100_ALIASES.length; i++) {
    const a = VN100_ALIASES[i];
    const exp = vn100Expiries[i] ?? null;
    contracts.push({
      symbol: a.symbol,
      productId: "VN100_INDEX_FUT",
      exchange: "HNX",
      underlying: "VN100",
      continuousAlias: a.symbol,
      expiryDate: exp ? isoDate(exp) : null,
      lastTradeDate: exp ? isoDate(exp) : null,
      multiplier: 100_000,
      tickSize: 0.1,
      status: "MONITORING",
      priority: a.priority,
      source: VSDC,
      sourceUrl: HNX_DERIV_URL,
      retrievedAt,
      effectiveFrom: retrievedAt,
      daysToExpiry: exp ? daysBetween(now, exp) : null,
    });
  }

  contracts.push(
    {
      symbol: "GB05F1M",
      productId: "GB05_BOND_FUT",
      exchange: "HNX",
      underlying: "GB05",
      continuousAlias: "GB05F1M",
      status: "MONITORING",
      priority: 50,
      source: VSDC,
      sourceUrl: HNX_DERIV_URL,
      retrievedAt,
      effectiveFrom: retrievedAt,
      daysToExpiry: null,
    },
    {
      symbol: "GB10F1M",
      productId: "GB10_BOND_FUT",
      exchange: "HNX",
      underlying: "GB10",
      continuousAlias: "GB10F1M",
      status: "MONITORING",
      priority: 51,
      source: VSDC,
      sourceUrl: HNX_DERIV_URL,
      retrievedAt,
      effectiveFrom: retrievedAt,
      daysToExpiry: null,
    },
  );

  return contracts.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
}

export function getProductById(id: string): DerivativeProduct | null {
  return PRODUCT_CATALOG.find((p) => p.id === id) ?? null;
}

export function getContractBySymbol(symbol: string, now = new Date()): DerivativeContract | null {
  const sym = symbol.toUpperCase();
  return buildContractMaster(now).find((c) => c.symbol === sym) ?? null;
}
