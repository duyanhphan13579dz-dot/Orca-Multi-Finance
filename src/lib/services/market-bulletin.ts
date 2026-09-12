import "server-only";
import { cached } from "../cache";
import { buildMeta } from "../freshness";
import { buildMarketIntel } from "./market-intel";
import type { IndexQuote, Meta } from "../types";

export interface BulletinOverview {
  vnIndex: IndexQuote | null;
  vn30: IndexQuote | null;
  hnx: IndexQuote | null;
  advancers: number;
  decliners: number;
  unchanged: number;
}

export interface BulletinFlow {
  foreignNetValue: number | null;
  totalValueTraded: number | null;
  previousSessionValue: number | null;
  etfNet: number | null;
}

export interface BulletinTopMover {
  symbol: string;
  changePercent: number | null;
  change: number | null;
  price: number | null;
  volume: number | null;
}

export interface BulletinSectors {
  topGainers: BulletinTopMover[];
  topLosers: BulletinTopMover[];
  limitUpCount: number;
  limitDownCount: number;
  volumeLeaders: BulletinTopMover[];
}

export interface BulletinTechnical {
  marketMomentum: string;
  trendAssessment: string;
  liquidityStatus: string;
  keySupport: number | null;
  keyResistance: number | null;
  tradingRecommendation: string;
}

export interface MarketBulletin {
  sessionTime: string;
  updateTime: string;
  overview: BulletinOverview;
  flow: BulletinFlow;
  sectors: BulletinSectors;
  technical: BulletinTechnical;
  sessionHint: string;
}

export async function buildMarketBulletin(): Promise<{ bulletin: MarketBulletin; meta: Meta }> {
  const res = await cached("market:bulletin:v1", {
    ttlMs: 15_000,
    staleMs: 20 * 60_000,
    producer: async () => {
      const { intel, meta } = await buildMarketIntel();

      // 1. VN-Index Overview
      const vnIndex = intel.indices?.find((i) => i.code === "VNINDEX") ?? null;
      const vn30 = intel.indices?.find((i) => i.code === "VN30") ?? null;
      const hnx = intel.indices?.find((i) => i.code === "HNXINDEX") ?? null;

      const overview: BulletinOverview = {
        vnIndex,
        vn30,
        hnx,
        advancers: intel.breadth.advancers,
        decliners: intel.breadth.decliners,
        unchanged: intel.breadth.unchanged,
      };

      // 2. Money Flow & Liquidity
      const flow: BulletinFlow = {
        foreignNetValue: intel.flow.foreignNet,
        totalValueTraded: intel.liquidity.valueTraded,
        previousSessionValue: intel.liquidity.baseline,
        etfNet: intel.flow.etfNet,
      };

      // 3. Sectors & Highlights — extract top movers from contributors
      const contribPositive = intel.contributors.positive.slice(0, 5);
      const contribNegative = intel.contributors.negative.slice(0, 5);

      const topGainers: BulletinTopMover[] = contribPositive.map((c) => ({
        symbol: c.symbol,
        changePercent: c.changePercent,
        change: null,
        price: null,
        volume: null,
      }));

      const topLosers: BulletinTopMover[] = contribNegative.map((c) => ({
        symbol: c.symbol,
        changePercent: c.changePercent,
        change: null,
        price: null,
        volume: null,
      }));

      // Count limit up/down (using ceiling/floor price logic from quotes if available)
      let limitUpCount = 0;
      let limitDownCount = 0;

      // Placeholder for volume leaders (would need full board data)
      const volumeLeaders: BulletinTopMover[] = [];

      const sectors: BulletinSectors = {
        topGainers,
        topLosers,
        limitUpCount,
        limitDownCount,
        volumeLeaders,
      };

      // 4. Technical Insights
      const conditionScore = intel.condition.score ?? 50;
      const trendLabel = intel.condition.rating ?? "NEUTRAL";

      let marketMomentum = "Trung lập";
      if (conditionScore > 70) marketMomentum = "Mạnh mẽ tăng";
      else if (conditionScore > 55) marketMomentum = "Tăng nhẹ";
      else if (conditionScore < 30) marketMomentum = "Mạnh mẽ giảm";
      else if (conditionScore < 45) marketMomentum = "Giảm nhẹ";

      const trendAssessment = trendLabel;

      let liquidityStatus = "Bình thường";
      if (intel.liquidity.available && intel.liquidity.valueTraded && intel.liquidity.baseline) {
        const ratio = intel.liquidity.valueTraded / intel.liquidity.baseline;
        if (ratio > 1.2) liquidityStatus = "Cao";
        else if (ratio < 0.8) liquidityStatus = "Thấp";
      }

      // Support/Resistance (placeholder — would use technical engine)
      const keySupport = vnIndex?.value ? vnIndex.value * 0.99 : null;
      const keyResistance = vnIndex?.value ? vnIndex.value * 1.01 : null;

      let tradingRecommendation = "Chờ tín hiệu";
      if (conditionScore > 65 && overview.advancers > overview.decliners) {
        tradingRecommendation = "Tích cực, duy trì lâu hạn";
      } else if (conditionScore < 35 && overview.decliners > overview.advancers) {
        tradingRecommendation = "Cẩn trọng, tìm cơ hội";
      }

      const technical: BulletinTechnical = {
        marketMomentum,
        trendAssessment,
        liquidityStatus,
        keySupport,
        keyResistance,
        tradingRecommendation,
      };

      const bulletin: MarketBulletin = {
        sessionTime: intel.sessionHint,
        updateTime: new Date().toISOString(),
        overview,
        flow,
        sectors,
        technical,
        sessionHint: intel.sessionHint,
      };

      return {
        bulletin,
        meta: buildMeta({
          source: intel.vnDataNote ?? "Market Intel aggregated (VNDirect, CafeF)",
          sourceTimestampMs: Date.now(),
          note: "Cập nhật giữa phiên từ 11h30 trở về sau",
          slas: { liveSlaMs: 30_000, freshSlaMs: 120_000, delayedSlaMs: 600_000 },
        }),
      };
    },
  });

  return res.value;
}
