import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type Db = NodePgDatabase;

const globalForDb = globalThis as typeof globalThis & {
  __orcaPgPool?: Pool;
  __orcaDrizzleDb?: Db;
};

/** Is a database URL configured? Lets ops endpoints report honestly without throwing. */
export function databaseConfigured(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return false;
  if (url.includes("<") || url.includes(">") || url.includes("example.com")) return false;
  return true;
}

function createMockPool(): Pool {
  console.warn("[AI Studio] Database not connected — using mock Pool");
  return {
    query: async () => ({ rows: [], rowCount: 0 }),
    connect: async () => ({
      query: async () => ({ rows: [], rowCount: 0 }),
      release: () => {},
    }),
    on: () => {},
    end: async () => {},
  } as unknown as Pool;
}

function createMockDb(): Db {
  console.warn("[AI Studio] Database not connected — using mock Drizzle client");
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {},
    delete: async () => ({}),
  };

  const createChainable = (isInsert = false): any => {
    const chain: any = () => chain;
    const defaultResult = isInsert ? [{ id: "mock_" + Date.now() }] : [];
    const promise = Promise.resolve(defaultResult);

    return new Proxy(chain, {
      get(_target, prop) {
        if (prop === "then") return promise.then.bind(promise);
        if (prop === "catch") return promise.catch.bind(promise);
        if (prop === "finally") return promise.finally.bind(promise);
        if (prop === "returning") {
          return () => Promise.resolve([{ id: "mock_" + Date.now() }]);
        }
        return createChainable(isInsert);
      },
      apply() {
        return createChainable(isInsert);
      },
    });
  };

  return new Proxy({} as Db, {
    get(_target, prop) {
      if (prop === "query") {
        return new Proxy({}, { get: () => noOp });
      }
      if (prop === "insert") {
        return () => createChainable(true);
      }
      if (prop === "execute") {
        return async () => ({ rows: [], rowCount: 0 });
      }
      return createChainable(false);
    },
  });
}

/** Real `pg` Pool or mock when DATABASE_URL is not configured or connection fails */
export function getPool(): Pool {
  if (!globalForDb.__orcaPgPool) {
    if (!databaseConfigured()) {
      globalForDb.__orcaPgPool = createMockPool();
    } else {
      try {
        globalForDb.__orcaPgPool = new Pool({
          connectionString: process.env.DATABASE_URL!.trim(),
        });
      } catch {
        globalForDb.__orcaPgPool = createMockPool();
      }
    }
  }
  return globalForDb.__orcaPgPool;
}

/** Real Drizzle client or mock when DATABASE_URL is not configured */
export function getDb(): Db {
  if (!globalForDb.__orcaDrizzleDb) {
    if (!databaseConfigured()) {
      globalForDb.__orcaDrizzleDb = createMockDb();
    } else {
      try {
        globalForDb.__orcaDrizzleDb = drizzle(getPool());
      } catch {
        globalForDb.__orcaDrizzleDb = createMockDb();
      }
    }
  }
  return globalForDb.__orcaDrizzleDb;
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
