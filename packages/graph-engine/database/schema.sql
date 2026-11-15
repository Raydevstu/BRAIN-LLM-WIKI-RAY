-- Portable Graph Engine Schema (PostgreSQL 15+ & PGlite compatible)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$ BEGIN
  CREATE TYPE graph_node_kind AS ENUM (
    'project', 'note', 'artifact', 'entity', 'concept', 'wiki_page', 'collection', 'source', 'doctrine', 'idea', 'custom'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE graph_review_state AS ENUM ('proposed', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE graph_event_status AS ENUM ('pending', 'processing', 'done', 'dead');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS graph_nodes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vault_path      TEXT UNIQUE,
  title           TEXT NOT NULL,
  kind            graph_node_kind NOT NULL DEFAULT 'note',
  category        TEXT NOT NULL DEFAULT 'Note',
  cluster         TEXT NOT NULL DEFAULT 'general',
  summary         TEXT NOT NULL DEFAULT '',
  content         TEXT NOT NULL DEFAULT '',
  content_hash    TEXT NOT NULL DEFAULT '',
  aliases         TEXT[] NOT NULL DEFAULT '{}',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  props           JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_key_anchor   BOOLEAN NOT NULL DEFAULT false,
  needs_attention BOOLEAN NOT NULL DEFAULT false,
  review_state    graph_review_state NOT NULL DEFAULT 'approved',
  merged_into_id  UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
  pos_x           DOUBLE PRECISION,
  pos_y           DOUBLE PRECISION,
  pos_z           DOUBLE PRECISION,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (merged_into_id IS NULL OR merged_into_id <> id)
);

ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS vault_path TEXT;
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE graph_nodes ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS graph_nodes_vault_path_uq ON graph_nodes (vault_path) WHERE vault_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS graph_nodes_kind_idx ON graph_nodes (kind);
CREATE INDEX IF NOT EXISTS graph_nodes_cluster_idx ON graph_nodes (cluster);
CREATE INDEX IF NOT EXISTS graph_nodes_title_trgm_idx ON graph_nodes USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS graph_nodes_aliases_gin_idx ON graph_nodes USING gin (aliases);
CREATE INDEX IF NOT EXISTS graph_nodes_tags_gin_idx ON graph_nodes USING gin (tags);
CREATE INDEX IF NOT EXISTS graph_nodes_fts_idx ON graph_nodes
  USING gin (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(content, '')));

CREATE TABLE IF NOT EXISTS graph_edges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id        UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  to_id          UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  edge_type      TEXT NOT NULL DEFAULT 'relates_to',
  confidence     REAL NOT NULL DEFAULT 1.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  source_id      UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
  review_state   graph_review_state NOT NULL DEFAULT 'approved',
  superseded_at  TIMESTAMPTZ,
  metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS graph_edges_active_uq
  ON graph_edges (from_id, to_id, edge_type)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS graph_edges_from_idx ON graph_edges (from_id, edge_type) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS graph_edges_to_idx ON graph_edges (to_id, edge_type) WHERE superseded_at IS NULL;

CREATE TABLE IF NOT EXISTS graph_claims (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  source_id      UUID REFERENCES graph_nodes(id) ON DELETE SET NULL,
  claim_text     TEXT NOT NULL,
  locator        TEXT,
  confidence     REAL NOT NULL DEFAULT 0.9 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  review_state   graph_review_state NOT NULL DEFAULT 'proposed',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS graph_claims_node_idx ON graph_claims (node_id);
CREATE INDEX IF NOT EXISTS graph_claims_source_idx ON graph_claims (source_id);

CREATE TABLE IF NOT EXISTS graph_embeddings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id        UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  chunk_index    INTEGER NOT NULL DEFAULT 0,
  chunk_text     TEXT NOT NULL,
  chunk_hash     TEXT NOT NULL DEFAULT '',
  model          TEXT NOT NULL DEFAULT 'gemini-embedding-2',
  embedding      vector(1536) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (node_id, chunk_index, model)
);

ALTER TABLE graph_embeddings ADD COLUMN IF NOT EXISTS chunk_hash TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS graph_embeddings_node_idx ON graph_embeddings (node_id);
CREATE INDEX IF NOT EXISTS graph_embeddings_fts_idx ON graph_embeddings USING gin (to_tsvector('english', chunk_text));

CREATE TABLE IF NOT EXISTS graph_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type      TEXT NOT NULL,
  node_id         UUID NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT UNIQUE,
  status          graph_event_status NOT NULL DEFAULT 'pending',
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  locked_by       TEXT,
  locked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS graph_events_pending_idx ON graph_events (status, created_at) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION graph_neighbors(start_id UUID, max_depth INTEGER DEFAULT 2)
RETURNS TABLE(node_id UUID, depth INTEGER)
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE walk(node_id, depth, visited) AS (
    SELECT start_id, 0, ARRAY[start_id]
    UNION ALL
    SELECT CASE WHEN e.from_id = g.node_id THEN e.to_id ELSE e.from_id END AS next_id,
           g.depth + 1,
           g.visited || (CASE WHEN e.from_id = g.node_id THEN e.to_id ELSE e.from_id END)
      FROM walk g
      JOIN graph_edges e
        ON (e.from_id = g.node_id OR e.to_id = g.node_id)
     WHERE g.depth < max_depth
       AND e.superseded_at IS NULL
       AND e.review_state <> 'rejected'
       AND NOT ((CASE WHEN e.from_id = g.node_id THEN e.to_id ELSE e.from_id END) = ANY(g.visited))
  )
  SELECT DISTINCT ON (w.node_id) w.node_id, w.depth
    FROM walk w
   ORDER BY w.node_id, w.depth ASC;
$$;

CREATE OR REPLACE FUNCTION graph_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS graph_nodes_updated_trg ON graph_nodes;
CREATE TRIGGER graph_nodes_updated_trg
  BEFORE UPDATE ON graph_nodes
  FOR EACH ROW EXECUTE FUNCTION graph_set_updated_at();
