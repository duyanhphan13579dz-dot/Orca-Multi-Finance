import {
  pgTable, text, uuid, timestamp, integer, bigint, numeric, boolean, jsonb, primaryKey, index,
} from "drizzle-orm/pg-core";

/* ---------------------------------- Auth ---------------------------------- */

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const auditLogs = pgTable("audit_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id"),
  action: text("action").notNull(),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* -------------------------------- Watchlist ------------------------------- */

export const watchlists = pgTable("watchlists", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull().default("Default"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  watchlistId: uuid("watchlist_id").notNull().references(() => watchlists.id, { onDelete: "cascade" }),
  assetType: text("asset_type").notNull(), // stock | crypto | forex | commodity
  symbol: text("symbol").notNull(),
  sortOrder: integer("sort_order").default(0),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------ Stock universe ----------------------------- */

export const stockSymbols = pgTable("stock_symbols", {
  symbol: text("symbol").primaryKey(),
  name: text("name"),
  exchange: text("exchange"), // HOSE | HNX | UPCOM
  industry: text("industry"),
  sector: text("sector"),
  source: text("source"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const stockQuotes = pgTable(
  "stock_quotes",
  {
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    open: numeric("open"), high: numeric("high"), low: numeric("low"), close: numeric("close"),
    volume: numeric("volume"), value: numeric("value"),
    change: numeric("change"), changePercent: numeric("change_percent"),
    source: text("source"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.ts] }), index("stock_quotes_symbol_idx").on(t.symbol)],
);

export const stockOhlcv = pgTable(
  "stock_ohlcv",
  {
    symbol: text("symbol").notNull(),
    date: text("date").notNull(), // YYYY-MM-DD
    open: numeric("open"), high: numeric("high"), low: numeric("low"), close: numeric("close"),
    volume: numeric("volume"),
    source: text("source"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

export const financialStatements = pgTable(
  "financial_statements",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    symbol: text("symbol").notNull(),
    periodYear: integer("period_year").notNull(),
    periodQuarter: integer("period_quarter"), // null = annual
    reportType: text("report_type").notNull(), // income | balance | cashflow | ratios
    metrics: jsonb("metrics").notNull(),
    source: text("source").notNull(),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("fin_stmt_symbol_idx").on(t.symbol, t.reportType)],
);

/* ------------------------------ Crypto / Forex ----------------------------- */

export const cryptoSymbols = pgTable("crypto_symbols", {
  symbol: text("symbol").primaryKey(),
  baseAsset: text("base_asset"),
  quoteAsset: text("quote_asset"),
  status: text("status"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const cryptoQuotes = pgTable(
  "crypto_quotes",
  {
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    price: numeric("price"),
    changePercent: numeric("change_percent"),
    volume: numeric("volume"),
    quoteVolume: numeric("quote_volume"),
    high: numeric("high"), low: numeric("low"),
    source: text("source"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.ts] })],
);

export const cryptoFuturesMetrics = pgTable(
  "crypto_futures_metrics",
  {
    symbol: text("symbol").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    fundingRate: numeric("funding_rate"),
    openInterest: numeric("open_interest"),
    markPrice: numeric("mark_price"),
    source: text("source"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.ts] })],
);

export const forexQuotes = pgTable(
  "forex_quotes",
  {
    pair: text("pair").notNull(),
    ts: timestamp("ts", { withTimezone: true }).notNull(),
    rate: numeric("rate"),
    change: numeric("change"),
    changePercent: numeric("change_percent"),
    source: text("source"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.pair, t.ts] })],
);

/* ------------------------------- Commodities ------------------------------- */

export const commodityQuotes = pgTable(
  "commodity_quotes",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    commodity: text("commodity").notNull(),
    symbol: text("symbol").notNull(),
    group: text("group").notNull(), // metals | energy | industrial | agriculture | vietnam
    price: numeric("price"),
    change: numeric("change"),
    changePercent: numeric("change_percent"),
    unit: text("unit"),
    currency: text("currency"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    sourceTimestamp: timestamp("source_timestamp", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("commodity_symbol_idx").on(t.symbol)],
);

/* ---------------------------------- News ---------------------------------- */

export const newsArticles = pgTable(
  "news",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    url: text("url").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary"),
    source: text("source").notNull(),
    category: text("category"), // market | corporate | macro | crypto | forex | commodities
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    relatedSymbols: jsonb("related_symbols"),
    relatedSector: text("related_sector"),
    sentiment: text("sentiment"),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("news_published_idx").on(t.publishedAt)],
);

/* --------------------------------- Reports --------------------------------- */

export const reports = pgTable("reports", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(), // morning_brief | market_summary | sector | stock | custom
  title: text("title").notNull(),
  body: jsonb("body").notNull(),
  marketDataTimestamp: timestamp("market_data_timestamp", { withTimezone: true }),
  newsDataTimestamp: timestamp("news_data_timestamp", { withTimezone: true }),
  freshness: text("freshness"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------ Snapshots / Ops ---------------------------- */

export const marketSnapshots = pgTable("market_snapshots", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  scope: text("scope").notNull(), // global | crypto | forex | commodities | vn_stocks
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerHealth = pgTable("provider_health", {
  provider: text("provider").primaryKey(),
  status: text("status").notNull().default("unknown"), // healthy | degraded | down | unknown
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
  lastLatencyMs: integer("last_latency_ms"),
  avgLatencyMs: integer("avg_latency_ms"),
  successCount: integer("success_count").default(0),
  failureCount: integer("failure_count").default(0),
  consecutiveFailures: integer("consecutive_failures").default(0),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const providerLogs = pgTable(
  "provider_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    provider: text("provider").notNull(),
    event: text("event").notNull(), // success | failure | circuit_open
    message: text("message"),
    latencyMs: integer("latency_ms"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("provider_logs_provider_idx").on(t.provider)],
);

/* ------------------------------- Trade journal ----------------------------- */

export const tradeJournal = pgTable("trade_journal", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id"),
  assetType: text("asset_type").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull().default("long"),
  entry: numeric("entry"),
  exit: numeric("exit"),
  stopLoss: numeric("stop_loss"),
  takeProfit: numeric("take_profit"),
  positionSize: numeric("position_size"),
  leverage: numeric("leverage"),
  pnl: numeric("pnl"),
  rMultiple: numeric("r_multiple"),
  emotion: text("emotion"),
  strategy: text("strategy"),
  notes: text("notes"),
  status: text("status").default("open"),
  openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  settings: jsonb("settings").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const alerts = pgTable("alerts", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id"),
  assetType: text("asset_type").notNull(),
  symbol: text("symbol").notNull(),
  condition: text("condition").notNull(), // price_above | price_below | pct_change | rsi | volume_spike
  threshold: numeric("threshold"),
  active: boolean("active").default(true),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* -------------------------- Financial memory (AI) -------------------------- */
/* Tách riêng khỏi conversation memory theo spec AI Agent: chỉ lưu khi user
 * đồng ý (consent), gắn userId để access control, không trộn dữ liệu giữa user. */

export const financialProfiles = pgTable("financial_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  profile: jsonb("profile").notNull(),
  consent: boolean("consent").notNull().default(false),
  consentAt: timestamp("consent_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const financialMemoryLogs = pgTable("financial_memory_logs", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  action: text("action").notNull(), // upsert | delete | consent
  meta: jsonb("meta"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
