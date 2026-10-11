import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex Realtime Schema - Orca Financial
 * Quản lý trạng thái realtime của người dùng (Watchlist, Alerts, Trade Journal, Hot State)
 * Dữ liệu tài chính vĩ mô & BCTC vẫn lưu bền vững trên Neon PostgreSQL.
 */
export default defineSchema({
  // 1. Danh mục theo dõi Realtime (Watchlist)
  watchlists: defineTable({
    userId: v.optional(v.string()),
    symbol: v.string(),
    assetType: v.string(), // "stock" | "crypto" | "forex" | "commodity" | "derivative"
    name: v.optional(v.string()),
    notes: v.optional(v.string()),
    addedAt: v.number(),
  })
    .index("by_symbol", ["symbol"])
    .index("by_user", ["userId"])
    .index("by_asset_type", ["assetType"]),

  // 2. Cảnh báo giá Realtime (Price Alerts)
  alerts: defineTable({
    userId: v.optional(v.string()),
    symbol: v.string(),
    assetType: v.string(),
    condition: v.string(), // "above" | "below" | "change_pct"
    threshold: v.number(),
    active: v.boolean(),
    triggeredAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_symbol", ["symbol"])
    .index("by_active", ["active"]),

  // 3. Nhật ký giao dịch Realtime (Trade Journal)
  tradeJournal: defineTable({
    userId: v.optional(v.string()),
    symbol: v.string(),
    assetType: v.string(),
    side: v.string(), // "long" | "short"
    entry: v.number(),
    exit: v.optional(v.number()),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    quantity: v.optional(v.number()),
    pnl: v.optional(v.number()),
    strategy: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.string(), // "open" | "closed"
    openedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_symbol", ["symbol"])
    .index("by_status", ["status"]),

  // 4. Hot Market Snapshots (Cache nóng trạng thái thị trường)
  marketHotSnapshots: defineTable({
    scope: v.string(), // "vn30" | "derivatives" | "commodities" | "screener"
    payload: v.any(),
    updatedAt: v.number(),
  }).index("by_scope", ["scope"]),
});
