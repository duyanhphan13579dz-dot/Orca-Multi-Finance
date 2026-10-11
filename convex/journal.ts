import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Convex Trade Journal API - Realtime Portfolio & Trading Log
 */

export const list = query({
  args: {
    status: v.optional(v.string()), // "open" | "closed"
  },
  handler: async (ctx, args) => {
    const items = args.status
      ? await ctx.db
          .query("tradeJournal")
          .withIndex("by_status", (x: any) => x.eq("status", args.status))
          .collect()
      : await ctx.db.query("tradeJournal").collect();
    return items.sort((a: any, b: any) => b.openedAt - a.openedAt);
  },
});

export const create = mutation({
  args: {
    symbol: v.string(),
    assetType: v.string(),
    side: v.string(),
    entry: v.number(),
    stopLoss: v.optional(v.number()),
    takeProfit: v.optional(v.number()),
    quantity: v.optional(v.number()),
    strategy: v.optional(v.string()),
    notes: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("tradeJournal", {
      symbol: args.symbol.toUpperCase(),
      assetType: args.assetType,
      side: args.side,
      entry: args.entry,
      stopLoss: args.stopLoss,
      takeProfit: args.takeProfit,
      quantity: args.quantity,
      strategy: args.strategy,
      notes: args.notes,
      status: "open",
      userId: args.userId,
      openedAt: Date.now(),
    });
  },
});

export const close = mutation({
  args: {
    id: v.id("tradeJournal"),
    exit: v.number(),
    pnl: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      exit: args.exit,
      pnl: args.pnl,
      notes: args.notes,
      status: "closed",
      closedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    id: v.id("tradeJournal"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
