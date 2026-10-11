import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Convex Watchlists API - Realtime Watchlist Engine
 */

export const list = query({
  args: {
    userId: v.optional(v.string()),
    assetType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const items = args.userId
      ? await ctx.db
          .query("watchlists")
          .withIndex("by_user", (x: any) => x.eq("userId", args.userId))
          .collect()
      : await ctx.db.query("watchlists").collect();

    if (args.assetType) {
      return items.filter((i: any) => i.assetType === args.assetType);
    }
    return items.sort((a: any, b: any) => b.addedAt - a.addedAt);
  },
});

export const has = query({
  args: {
    symbol: v.string(),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sym = args.symbol.toUpperCase();
    const existing = await ctx.db
      .query("watchlists")
      .withIndex("by_symbol", (x) => x.eq("symbol", sym))
      .first();
    return existing !== null;
  },
});

export const add = mutation({
  args: {
    symbol: v.string(),
    assetType: v.string(),
    name: v.optional(v.string()),
    notes: v.optional(v.string()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sym = args.symbol.toUpperCase();
    const existing = await ctx.db
      .query("watchlists")
      .withIndex("by_symbol", (x) => x.eq("symbol", sym))
      .first();

    if (existing) {
      return existing._id;
    }

    return await ctx.db.insert("watchlists", {
      symbol: sym,
      assetType: args.assetType,
      name: args.name,
      notes: args.notes,
      userId: args.userId,
      addedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: {
    symbol: v.string(),
  },
  handler: async (ctx, args) => {
    const sym = args.symbol.toUpperCase();
    const existing = await ctx.db
      .query("watchlists")
      .withIndex("by_symbol", (x) => x.eq("symbol", sym))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return true;
    }
    return false;
  },
});

export const toggle = mutation({
  args: {
    symbol: v.string(),
    assetType: v.string(),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const sym = args.symbol.toUpperCase();
    const existing = await ctx.db
      .query("watchlists")
      .withIndex("by_symbol", (x) => x.eq("symbol", sym))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { added: false };
    } else {
      await ctx.db.insert("watchlists", {
        symbol: sym,
        assetType: args.assetType,
        name: args.name,
        addedAt: Date.now(),
      });
      return { added: true };
    }
  },
});
