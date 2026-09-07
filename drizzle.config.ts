import "dotenv/config";
import { defineConfig } from "drizzle-kit";

/**
 * Drizzle Kit configuration (replaces drizzle.config.json).
 *
 * Why this is a TS config instead of JSON: JSON cannot read the environment,
 * and the previous file hardcoded `postgresql://postgres:postgres@127.0.0.1:5432/app_db`,
 * which meant `drizzle-kit push` silently targeted localhost instead of the
 * real (Neon) database.
 *
 * Migrations need a DIRECT, unpooled connection: PgBouncer in transaction
 * pooling mode (Neon's "-pooler" host) does not handle the long sessions and
 * prepared statements drizzle-kit uses. So DATABASE_URL_UNPOOLED wins, and
 * DATABASE_URL is the fallback for local development.
 *
 * Usage:
 *   npx drizzle-kit push       # sync schema to the database
 *   npx drizzle-kit generate   # emit SQL into ./drizzle
 *   npx drizzle-kit migrate    # apply generated migrations
 *   npx drizzle-kit studio     # browse data
 */

const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.DATABASE_URL?.trim() ||
  "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

const target = process.env.DATABASE_URL_UNPOOLED?.trim()
  ? "DATABASE_URL_UNPOOLED"
  : process.env.DATABASE_URL?.trim()
    ? "DATABASE_URL"
    : "built-in localhost default";

// Printed so it is obvious which database migrations are about to touch.
console.log(`[drizzle-kit] dialect=postgresql · schema=./src/db/schema.ts · credentials from ${target}`);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
