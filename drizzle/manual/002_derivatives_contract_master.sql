-- P0 Vietnam Derivatives — Contract Master tables
-- Run via: psql $DATABASE_URL -f drizzle/manual/002_derivatives_contract_master.sql
-- Or: pnpm exec drizzle-kit push (after schema.ts update)

CREATE TABLE IF NOT EXISTS derivative_products (
  id text PRIMARY KEY,
  exchange text NOT NULL,
  underlying text NOT NULL,
  contract_type text NOT NULL,
  name text NOT NULL,
  name_en text,
  multiplier numeric,
  tick_size numeric,
  currency text DEFAULT 'VND',
  quote_unit text,
  settlement_type text,
  settlement_method text,
  position_limit integer,
  source text,
  source_url text,
  effective_from timestamptz,
  effective_to timestamptz,
  status text NOT NULL DEFAULT 'ACTIVE',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS derivative_contracts (
  symbol text PRIMARY KEY,
  product_id text NOT NULL REFERENCES derivative_products(id),
  exchange text NOT NULL,
  underlying text NOT NULL,
  contract_code text,
  continuous_alias text,
  listing_date timestamptz,
  expiry_date timestamptz,
  last_trade_date timestamptz,
  first_notice_date timestamptz,
  initial_margin numeric,
  maintenance_margin numeric,
  multiplier numeric,
  tick_size numeric,
  status text NOT NULL DEFAULT 'ACTIVE',
  priority integer DEFAULT 100,
  source text,
  source_url text,
  retrieved_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS derivative_contracts_product_idx ON derivative_contracts(product_id);
CREATE INDEX IF NOT EXISTS derivative_contracts_underlying_idx ON derivative_contracts(underlying);
CREATE INDEX IF NOT EXISTS derivative_contracts_status_idx ON derivative_contracts(status);

CREATE TABLE IF NOT EXISTS derivative_prices (
  symbol text NOT NULL,
  ts timestamptz NOT NULL,
  last numeric,
  mark numeric,
  settlement numeric,
  change numeric,
  change_percent numeric,
  open numeric,
  high numeric,
  low numeric,
  volume numeric,
  open_interest numeric,
  basis numeric,
  source text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, ts)
);

CREATE TABLE IF NOT EXISTS derivative_open_interest (
  symbol text NOT NULL,
  ts timestamptz NOT NULL,
  open_interest numeric,
  oi_change numeric,
  source text,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, ts)
);
