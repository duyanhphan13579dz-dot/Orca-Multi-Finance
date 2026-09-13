import { env } from "../lib/env";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * LAZY DATABASE CLIENT
 *
 * The Pool — and therefore `DATABASE_URL` — is only required when a query
 * actually runs, never at module-evaluation time.
 *
 * Why this matters: `next build` evaluates every route module during the
 * "Collecting page data" step. When this file threw at import time the whole
 * production build died with `Error: DATABASE_URL is required` (failing at
 * /api/health) on any host that does not inject the database URL into the
 * *build* environment. Runtime behaviour is unchanged: the first real query
 * still throws the same explicit message, and every caller in this codebase
 * already treats DB access as best-effort inside try/catch.
 */

type Db = NodePgDatabase;

const globalForDb = globalThis as typeof globalThis & {
  __orcaPgPool?: Pool;
  __orcaDrizzleDb?: Db;
};

function requireDatabaseUrl(): string {
  if (!env.databaseUrl) throw new Error("DATABASE_URL is required");
  return env.databaseUrl;
}

/** Real `pg` Pool, created on first use and shared across module instances. */
export function getPool(): Pool {
  if (!globalForDb.__orcaPgPool) {
    globalForDb.__orcaPgPool = new Pool({ connectionString: requireDatabaseUrl() });
  }
  return globalForDb.__orcaPgPool;
}

/** Real Drizzle client, created on first use. */
export function getDb(): Db {
  if (!globalForDb.__orcaDrizzleDb) {
    globalForDb.__orcaDrizzleDb = drizzle(getPool());
  }
  return globalForDb.__orcaDrizzleDb;
}

/** Is a database URL configured? Lets ops endpoints report honestly without throwing. */
export function databaseConfigured(): boolean {
  return Boolean(env.databaseUrl);
}

/**
 * Forward every property access to the lazily-created instance, binding methods
 * to it so `db.select()…`, `db.execute(sql)` and `pool.query(sql)` behave
 * exactly as the real objects would.
 */
function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const instance = resolve();
      const value = Reflect.get(instance, prop, instance);
      return typeof value === "function" ? value.bind(instance) : value;
    },
    has(_target, prop) {
      return Reflect.has(resolve(), prop);
    },
    set(_target, prop, value) {
      return Reflect.set(resolve(), prop, value);
    },
    getPrototypeOf() {
      return Reflect.getPrototypeOf(resolve());
    },
  });
}

/** Back-compat export: `import { pool } from "@/db"` keeps working. */
export const pool: Pool = lazy<Pool>(() => getPool());

/** Back-compat export: `import { db } from "@/db"` keeps working. */
export const db: Db = lazy<Db>(() => getDb());
