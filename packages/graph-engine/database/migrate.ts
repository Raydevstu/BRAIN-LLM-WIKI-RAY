import fs from "node:fs";
import path from "node:path";
import { getRawExecutor, isRemotePostgresUrl, type QueryExecutor } from "./client";

const PGLITE_VECTOR_SHIM_SQL = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
    CREATE DOMAIN vector AS real[];
  END IF;
END $$;

CREATE OR REPLACE FUNCTION graph_cosine_distance(a real[], b real[])
RETURNS double precision
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  dot double precision := 0;
  norm_a double precision := 0;
  norm_b double precision := 0;
  len int;
  i int;
BEGIN
  len := LEAST(COALESCE(array_length(a, 1), 0), COALESCE(array_length(b, 1), 0));
  IF len = 0 THEN
    RETURN 1.0;
  END IF;
  FOR i IN 1..len LOOP
    dot := dot + (a[i]::double precision * b[i]::double precision);
    norm_a := norm_a + (a[i]::double precision * a[i]::double precision);
    norm_b := norm_b + (b[i]::double precision * b[i]::double precision);
  END LOOP;
  IF norm_a = 0 OR norm_b = 0 THEN
    RETURN 1.0;
  END IF;
  RETURN 1.0 - (dot / (sqrt(norm_a) * sqrt(norm_b)));
END;
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_operator WHERE oprname = '<=>') THEN
    CREATE OPERATOR <=> (
      LEFTARG = real[],
      RIGHTARG = real[],
      FUNCTION = graph_cosine_distance
    );
  END IF;
END $$;
`;

function loadSchemaSql(): string {
  const candidates = [
    path.join(process.cwd(), "packages", "graph-engine", "database", "schema.sql"),
    path.join(process.cwd(), "database", "schema.sql"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, "utf8");
    }
  }
  throw new Error("Could not locate packages/graph-engine/database/schema.sql");
}

async function runMigrations(exec: QueryExecutor): Promise<void> {
  if (isRemotePostgresUrl()) {
    await exec.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  } else {
    await exec.exec(PGLITE_VECTOR_SHIM_SQL);
  }

  let ddl = loadSchemaSql();
  if (!isRemotePostgresUrl()) {
    ddl = ddl.replace(/vector\(1536\)/g, "vector");
  }
  await exec.exec(ddl);

  if (isRemotePostgresUrl()) {
    await exec.exec(`
      CREATE INDEX IF NOT EXISTS graph_embeddings_hnsw_idx
      ON graph_embeddings USING hnsw (embedding vector_cosine_ops);
    `);
  }
}

export async function ensureGraphSchemaMigrated(): Promise<void> {
  if (global.__graphMigrated) return;
  if (!global.__graphMigratePromise) {
    global.__graphMigratePromise = (async () => {
      const exec = await getRawExecutor();
      await runMigrations(exec);
      global.__graphMigrated = true;
    })().catch((err) => {
      global.__graphMigratePromise = undefined;
      throw err;
    });
  }
  await global.__graphMigratePromise;
}
