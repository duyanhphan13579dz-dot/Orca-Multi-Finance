import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Db = NodePgDatabase;

const globalForDb = globalThis as typeof globalThis & {
  __orcaPgPool?: Pool;
  __orcaDrizzleDb?: Db;
};
const scopedPools = new WeakMap<object, Pool>();
const scopedDbs = new WeakMap<object, Db>();

type RuntimeDbConfig = { scope: object | null; connectionString: string | null };
function runtimeDbConfig(): RuntimeDbConfig {
  try {
    const runtime = getCloudflareContext() as unknown as { env?: Record<string, unknown>; ctx?: object };
    const hyperdrive = runtime.env?.HYPERDRIVE as { connectionString?: string } | undefined;
    const connectionString = hyperdrive?.connectionString?.trim();
    if (connectionString) return { scope: runtime.ctx ?? runtime.env ?? null, connectionString };
  } catch {
    // Outside a Worker request (e.g. local CLI/tests), use DATABASE_URL.
  }
  const url = process.env.DATABASE_URL?.trim();
  return { scope: null, connectionString: url && !url.includes("<") && !url.includes(">") && !url.includes("example.com") ? url : null };
}

/** Is a database URL configured? Lets ops endpoints report honestly without throwing. */
export function databaseConfigured(): boolean {
  return runtimeDbConfig().connectionString !== null;
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
  const config = runtimeDbConfig();
  if (config.scope) {
    const existing = scopedPools.get(config.scope);
    if (existing) return existing;
    const pool = config.connectionString ? new Pool({ connectionString: config.connectionString, max: 5, idleTimeoutMillis: 1_000 }) : createMockPool();
    scopedPools.set(config.scope, pool);
    return pool;
  }
  if (!globalForDb.__orcaPgPool) {
    globalForDb.__orcaPgPool = config.connectionString
      ? new Pool({ connectionString: config.connectionString })
      : createMockPool();
  }
  return globalForDb.__orcaPgPool;
}

/** Real Drizzle client or mock when DATABASE_URL is not configured */
export function getDb(): Db {
  const config = runtimeDbConfig();
  if (config.scope) {
    const existing = scopedDbs.get(config.scope);
    if (existing) return existing;
    let instance: Db;
    try { instance = config.connectionString ? drizzle(getPool()) : createMockDb(); }
    catch { instance = createMockDb(); }
    scopedDbs.set(config.scope, instance);
    return instance;
  }
  if (!globalForDb.__orcaDrizzleDb) {
    try { globalForDb.__orcaDrizzleDb = config.connectionString ? drizzle(getPool()) : createMockDb(); }
    catch { globalForDb.__orcaDrizzleDb = createMockDb(); }
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
