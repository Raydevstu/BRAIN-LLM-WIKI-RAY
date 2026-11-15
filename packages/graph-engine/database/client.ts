import postgres from "postgres";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { createHash } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

export interface QueryExecutor {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
  exec(rawSql: string): Promise<void>;
}

declare global {
  var __graphPgSql: ReturnType<typeof postgres> | undefined;
  var __graphPglite: PGlite | undefined;
  var __graphDbInitPromise: Promise<QueryExecutor> | undefined;
  var __graphMigrated: boolean | undefined;
  var __graphMigratePromise: Promise<void> | undefined;
  var __graphMutexPromise: Promise<unknown> | undefined;
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function toUuid(idOrSeed: string): string {
  const trimmed = (idOrSeed || "").trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  ) {
    return trimmed.toLowerCase();
  }
  const h = sha256Hex(trimmed || "graph-default");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(
    17,
    20
  )}-${h.slice(20, 32)}`;
}

export function isRemotePostgresUrl(): boolean {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || url === "MY_DATABASE_URL") return false;
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

async function createExecutor(): Promise<QueryExecutor> {
  if (isRemotePostgresUrl()) {
    const connStr = process.env.DATABASE_URL!.trim();
    if (!global.__graphPgSql) {
      global.__graphPgSql = postgres(connStr, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 15,
      });
    }
    const sqlClient = global.__graphPgSql;
    return {
      async query<T = Record<string, unknown>>(
        text: string,
        params: unknown[] = []
      ): Promise<{ rows: T[] }> {
        const result = await sqlClient.unsafe<T[]>(
          text,
          params as postgres.ParameterOrJSON<never>[]
        );
        return { rows: Array.from(result) };
      },
      async exec(rawSql: string): Promise<void> {
        await sqlClient.unsafe(rawSql);
      },
    };
  }

  if (!global.__graphPglite) {
    const customDir = process.env.GRAPH_PGDATA_DIR?.trim();
    const dataDir =
      customDir || path.join(process.cwd(), ".graph-engine", "pgdata");
    fs.mkdirSync(dataDir, { recursive: true });
    global.__graphPglite = await PGlite.create({
      dataDir,
      extensions: { pg_trgm, pgcrypto },
    });
  }

  const pgl = global.__graphPglite;
  return {
    async query<T = Record<string, unknown>>(
      text: string,
      params: unknown[] = []
    ): Promise<{ rows: T[] }> {
      const res = await pgl.query<T>(text, params);
      return { rows: res.rows };
    },
    async exec(rawSql: string): Promise<void> {
      await pgl.exec(rawSql);
    },
  };
}

export async function getRawExecutor(): Promise<QueryExecutor> {
  if (!global.__graphDbInitPromise) {
    global.__graphDbInitPromise = createExecutor();
  }
  return global.__graphDbInitPromise;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  if (isRemotePostgresUrl()) return fn();
  const prev = global.__graphMutexPromise || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  global.__graphMutexPromise = prev.then(() => next);
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

export async function dbQuery<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<{ rows: T[] }> {
  const exec = await getRawExecutor();
  if (!global.__graphMigrated) {
    const { ensureGraphSchemaMigrated } = await import("./migrate");
    await ensureGraphSchemaMigrated();
  }
  return withLock(() => exec.query<T>(text, params));
}

export async function dbTransaction<T>(
  fn: (tx: QueryExecutor) => Promise<T>
): Promise<T> {
  const exec = await getRawExecutor();
  if (!global.__graphMigrated) {
    const { ensureGraphSchemaMigrated } = await import("./migrate");
    await ensureGraphSchemaMigrated();
  }

  if (isRemotePostgresUrl() && global.__graphPgSql) {
    const sqlClient = global.__graphPgSql;
    return (await sqlClient.begin(async (txSql) => {
      const txExec: QueryExecutor = {
        async query<R = Record<string, unknown>>(
          text: string,
          params: unknown[] = []
        ): Promise<{ rows: R[] }> {
          const rows = await txSql.unsafe<R[]>(
            text,
            params as postgres.ParameterOrJSON<never>[]
          );
          return { rows: Array.from(rows) };
        },
        async exec(rawSql: string): Promise<void> {
          await txSql.unsafe(rawSql);
        },
      };
      return fn(txExec);
    })) as T;
  }

  return withLock(async () => {
    await exec.exec("BEGIN");
    try {
      const result = await fn(exec);
      await exec.exec("COMMIT");
      return result;
    } catch (err) {
      await exec.exec("ROLLBACK");
      throw err;
    }
  });
}
