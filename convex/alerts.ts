import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Convex Price Alerts API - Realtime Notification Engine
 */

export const list = query({
  args: {
    activeOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const items = args.activeOnly
      ? await ctx.db
          .query("alerts")
          .withIndex("by_active", (x: any) => x.eq("active", true))
          .collect()
      : await ctx.db.query("alerts").collect();
    return items.sort((a: any, b: any) => b.createdAt - a.createdAt);
  },
});

export const create = mutation({
  args: {
    symbol: v.string(),
    assetType: v.string(),
    condition: v.string(), // "above" | "below"
    threshold: v.number(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("alerts", {
      symbol: args.symbol.toUpperCase(),
      assetType: args.assetType,
      condition: args.condition,
      threshold: args.threshold,
      active: true,
      userId: args.userId,
      createdAt: Date.now(),
    });
  },
});

export const toggle = mutation({
  args: {
    id: v.id("alerts"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { active: args.active });
  },
});

export const remove = mutation({
  args: {
    id: v.id("alerts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
