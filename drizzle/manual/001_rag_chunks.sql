-- Phase A RAG: document chunks (lexical retrieve)
-- Safe to run multiple times (IF NOT EXISTS)
--
-- Cách chạy (Neon SQL Editor hoặc psql):
--   psql "$DATABASE_URL_UNPOOLED" -f drizzle/manual/001_rag_chunks.sql
--
-- Hoặc trên máy local (có DATABASE_URL trong .env):
--   npx drizzle-kit push

CREATE TABLE IF NOT EXISTS rag_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  symbol text,
  sector text,
  title text,
  content text NOT NULL,
  source_url text,
  source_ts timestamptz,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rag_chunks_symbol_idx ON rag_chunks (symbol);
CREATE INDEX IF NOT EXISTS rag_chunks_source_idx ON rag_chunks (source);
