import { dbQuery, isRemotePostgresUrl, sha256Hex, toUuid } from "../database/client";
import { chunkText, EMBEDDING_MODEL, generateDeterministicEmbedding } from "./embeddings";
import type { GraphNodeKind } from "../types";

declare global {
  var __graphSeedPromise: Promise<void> | undefined;
}

interface SeedNodeSpec {
  seedKey: string;
  title: string;
  kind: GraphNodeKind;
  category: string;
  cluster: string;
  summary: string;
  content: string;
  tags: string[];
  isKeyAnchor: boolean;
  needsAttention?: boolean;
  x: number;
  y: number;
  z: number;
  claims?: Array<{ claimText: string; locator: string; confidence: number }>;
}

const SEED_NODES: SeedNodeSpec[] = [
  {
    seedKey: "seed:graph-core",
    title: "Knowledge Graph Core",
    kind: "project",
    category: "Project",
    cluster: "general",
    summary:
      "Unified relational graph architecture storing typed nodes, provenance-backed edges, claims, and 1536-dim vector chunks.",
    content:
      "# Knowledge Graph Core\n\nCentral architecture uniting relational adjacency traversal (`graph_neighbors`), pg_trgm deduplication, and hybrid RRF retrieval inside a single PostgreSQL/PGlite datastore.",
    tags: ["architecture", "graph-core", "postgres"],
    isKeyAnchor: true,
    x: 0,
    y: 22,
    z: 0,
    claims: [
      {
        claimText:
          "Single-datastore PostgreSQL/PGlite eliminates distributed sync drift between graph edges and vector chunks.",
        locator: "line 3",
        confidence: 0.96,
      },
    ],
  },
  {
    seedKey: "seed:hybrid-search",
    title: "Hybrid RRF Search",
    kind: "concept",
    category: "Concept",
    cluster: "engineering",
    summary:
      "Reciprocal Rank Fusion (k=60) combining English full-text search (ts_rank_cd) and dense vector cosine similarity.",
    content:
      "# Hybrid RRF Search\n\nExecutes lexical full-text ranking and 1536-dimensional cosine distance in parallel CTEs, merging top-50 candidates via 1 / (60 + rank).",
    tags: ["search", "rrf", "pgvector", "fts"],
    isKeyAnchor: true,
    x: -115,
    y: 18,
    z: -75,
    claims: [
      {
        claimText: "RRF constant k=60 balances exact keyword hits with semantic vector recall.",
        locator: "line 3",
        confidence: 0.94,
      },
    ],
  },
  {
    seedKey: "seed:recursive-traversal",
    title: "Recursive Neighborhood Walk",
    kind: "artifact",
    category: "Artifact",
    cluster: "engineering",
    summary:
      "Cycle-safe SQL recursive CTE function graph_neighbors(start_id, max_depth) preventing infinite loops via visited UUID arrays.",
    content:
      "# Recursive Neighborhood Walk\n\nTraverses active non-rejected edges bidirectionally up to depth 5 using `NOT (next_id = ANY(g.visited))` cycle guards.",
    tags: ["sql", "cte", "traversal"],
    isKeyAnchor: false,
    x: -155,
    y: -14,
    z: -35,
  },
  {
    seedKey: "seed:trigram-dedup",
    title: "Trigram Entity Deduplication",
    kind: "concept",
    category: "Concept",
    cluster: "research",
    summary:
      "Uses pg_trgm similarity > 0.82 and non-destructive merged_into_id pointers to prevent duplicate concept fragmentation.",
    content:
      "# Trigram Entity Deduplication\n\nIncoming entity mentions are matched against existing canonical titles using GIN trigram indexes before spawning new nodes.",
    tags: ["pg_trgm", "deduplication", "linking"],
    isKeyAnchor: false,
    x: 118,
    y: 26,
    z: -80,
  },
  {
    seedKey: "seed:gemini-embeddings",
    title: "Gemini Embedding Pipeline",
    kind: "entity",
    category: "Entity",
    cluster: "research",
    summary:
      "1536-dimension semantic vector indexing with 900-character overlapping chunking and deterministic offline fallback.",
    content:
      "# Gemini Embedding Pipeline\n\nSplits long-form notes into 900-char windows with 150-char overlap and embeds via gemini-embedding-2.",
    tags: ["embeddings", "gemini", "chunking"],
    isKeyAnchor: true,
    x: 145,
    y: 4,
    z: -15,
  },
  {
    seedKey: "seed:claim-provenance",
    title: "Line-Located Claim Provenance",
    kind: "wiki_page",
    category: "Wiki Page",
    cluster: "research",
    summary:
      "Verbatim source quotes anchored to exact line locators (e.g. line 14) for verifiable AI retrieval citations.",
    content:
      "# Line-Located Claim Provenance\n\nEvery extracted claim stores a verbatim quote and computed line locator so search answers link directly to verifiable evidence.",
    tags: ["provenance", "citations", "claims"],
    isKeyAnchor: false,
    x: 92,
    y: -24,
    z: 68,
  },
  {
    seedKey: "seed:webgl-renderer",
    title: "Three.js Spatial Canvas",
    kind: "artifact",
    category: "Artifact",
    cluster: "product",
    summary:
      "Hardware-adaptive WebGL 3D renderer with 6 morphing layouts, batched LineSegments edges, and Shift+Drag node positioning.",
    content:
      "# Three.js Spatial Canvas\n\nRenders distinct node geometries per kind, dynamically recolors focused neighborhoods, and projects 2D DOM labels at 60fps.",
    tags: ["threejs", "webgl", "3d-graph"],
    isKeyAnchor: true,
    x: -105,
    y: -18,
    z: 95,
  },
  {
    seedKey: "seed:pglite-shim",
    title: "PGlite Local Vector Shim",
    kind: "note",
    category: "Note",
    cluster: "engineering",
    summary:
      "Embedded Postgres 16 runtime implementing a real[] vector domain and <=> cosine distance operator for zero-config persistence.",
    content:
      "# PGlite Local Vector Shim\n\nAllows identical SQL queries to execute seamlessly in local embedded PGlite and remote pgvector PostgreSQL clusters.",
    tags: ["pglite", "postgres", "local-first"],
    isKeyAnchor: false,
    x: -55,
    y: 45,
    z: -115,
  },
  {
    seedKey: "seed:context-rag",
    title: "Subgraph Context Q&A",
    kind: "concept",
    category: "Concept",
    cluster: "product",
    summary:
      "Feeds a focus node and its 1-hop neighborhood into Gemini to generate grounded architectural answers.",
    content:
      "# Subgraph Context Q&A\n\nQueries `graph_neighbors(node_id, 1)` to assemble structured neighborhood context before invoking the language model.",
    tags: ["rag", "context", "qa"],
    isKeyAnchor: false,
    x: -25,
    y: -36,
    z: 118,
  },
  {
    seedKey: "seed:outbox-events",
    title: "Transactional Linking Outbox",
    kind: "note",
    category: "Note",
    cluster: "operations",
    summary:
      "Idempotent event queue (graph_events) coordinating asynchronous extraction, deduplication, and re-indexing.",
    content:
      "# Transactional Linking Outbox\n\nTracks pending, processing, done, and dead-letter ingestion events with idempotency keys.",
    tags: ["outbox", "reliability", "events"],
    isKeyAnchor: false,
    needsAttention: true,
    x: 115,
    y: -10,
    z: 105,
  },
  {
    seedKey: "seed:schema-ontology",
    title: "Node & Edge Ontology",
    kind: "collection",
    category: "Collection",
    cluster: "general",
    summary:
      "Canonical vocabulary covering 8 node kinds and 10 directed semantic edge types with confidence scores.",
    content:
      "# Node & Edge Ontology\n\nDefines directed relationship types (`supports`, `depends_on`, `implements`, `contradicts`, `derived_from`) with self-loop protection.",
    tags: ["ontology", "schema", "edges"],
    isKeyAnchor: false,
    x: 35,
    y: 55,
    z: 42,
  },
  {
    seedKey: "seed:staleness-audit",
    title: "Graph Health & Staleness Audit",
    kind: "note",
    category: "Note",
    cluster: "operations",
    summary:
      "Highlights unverified proposed edges, contradicting claims, and aging knowledge nodes needing review.",
    content:
      "# Graph Health & Staleness Audit\n\nSurfaces nodes flagged with `needs_attention` or high staleness days via the spatial heatmap overlay.",
    tags: ["audit", "staleness", "governance"],
    isKeyAnchor: false,
    needsAttention: true,
    x: 155,
    y: 35,
    z: 52,
  },
];

const SEED_EDGES: Array<{
  from: string;
  to: string;
  edgeType: string;
  confidence: number;
}> = [
  { from: "seed:graph-core", to: "seed:hybrid-search", edgeType: "implements", confidence: 0.96 },
  { from: "seed:graph-core", to: "seed:recursive-traversal", edgeType: "implements", confidence: 0.95 },
  { from: "seed:graph-core", to: "seed:schema-ontology", edgeType: "depends_on", confidence: 0.98 },
  { from: "seed:graph-core", to: "seed:webgl-renderer", edgeType: "relates_to", confidence: 0.92 },
  { from: "seed:hybrid-search", to: "seed:gemini-embeddings", edgeType: "depends_on", confidence: 0.95 },
  { from: "seed:hybrid-search", to: "seed:pglite-shim", edgeType: "supports", confidence: 0.91 },
  { from: "seed:hybrid-search", to: "seed:claim-provenance", edgeType: "derived_from", confidence: 0.89 },
  { from: "seed:gemini-embeddings", to: "seed:trigram-dedup", edgeType: "relates_to", confidence: 0.88 },
  { from: "seed:trigram-dedup", to: "seed:schema-ontology", edgeType: "supports", confidence: 0.87 },
  { from: "seed:claim-provenance", to: "seed:context-rag", edgeType: "supports", confidence: 0.93 },
  { from: "seed:recursive-traversal", to: "seed:context-rag", edgeType: "implements", confidence: 0.94 },
  { from: "seed:webgl-renderer", to: "seed:context-rag", edgeType: "relates_to", confidence: 0.86 },
  { from: "seed:outbox-events", to: "seed:gemini-embeddings", edgeType: "depends_on", confidence: 0.9 },
  { from: "seed:staleness-audit", to: "seed:outbox-events", edgeType: "relates_to", confidence: 0.84 },
  { from: "seed:staleness-audit", to: "seed:webgl-renderer", edgeType: "supports", confidence: 0.85 },
];

export async function seedDefaultGraphIfEmpty(): Promise<void> {
  if (global.__graphSeedPromise) {
    return global.__graphSeedPromise;
  }

  global.__graphSeedPromise = (async () => {
    const countRes = await dbQuery<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM graph_nodes"
    );
    const count = Number(countRes.rows[0]?.count || "0");
    if (count > 0) return;

    const idByKey = new Map<string, string>();
    for (const spec of SEED_NODES) {
      const id = toUuid(spec.seedKey);
      idByKey.set(spec.seedKey, id);
      await dbQuery(
        `INSERT INTO graph_nodes (
           id, title, kind, category, cluster, summary, content, content_hash,
           tags, is_key_anchor, needs_attention, review_state, pos_x, pos_y, pos_z
         )
         VALUES (
           $1::uuid, $2, $3::graph_node_kind, $4, $5, $6, $7, $8,
           $9::text[], $10, $11, 'approved'::graph_review_state, $12, $13, $14
         )
         ON CONFLICT (id) DO NOTHING`,
        [
          id,
          spec.title,
          spec.kind,
          spec.category,
          spec.cluster,
          spec.summary,
          spec.content,
          sha256Hex(`${spec.title}\n${spec.content}`),
          spec.tags,
          spec.isKeyAnchor,
          Boolean(spec.needsAttention),
          spec.x,
          spec.y,
          spec.z,
        ]
      );

      const chunks = chunkText(`${spec.title}\n\n${spec.content}`, 900, 150);
      for (let i = 0; i < chunks.length; i++) {
        const vec = generateDeterministicEmbedding(chunks[i]);
        const vecParam = isRemotePostgresUrl() ? `[${vec.join(",")}]` : vec;
        const vecCast = isRemotePostgresUrl() ? "$5::vector" : "$5::real[]";
        await dbQuery(
          `INSERT INTO graph_embeddings (node_id, chunk_index, chunk_text, model, embedding)
           VALUES ($1::uuid, $2, $3, $4, ${vecCast})
           ON CONFLICT (node_id, chunk_index, model) DO NOTHING`,
          [id, i, chunks[i], EMBEDDING_MODEL, vecParam]
        );
      }

      if (spec.claims) {
        for (const cl of spec.claims) {
          await dbQuery(
            `INSERT INTO graph_claims (node_id, source_id, claim_text, locator, confidence, review_state)
             VALUES ($1::uuid, $1::uuid, $2, $3, $4, 'approved'::graph_review_state)`,
            [id, cl.claimText, cl.locator, cl.confidence]
          );
        }
      }
    }

    for (const edge of SEED_EDGES) {
      const fromId = idByKey.get(edge.from);
      const toId = idByKey.get(edge.to);
      if (!fromId || !toId) continue;
      await dbQuery(
        `INSERT INTO graph_edges (from_id, to_id, edge_type, confidence, review_state)
         VALUES ($1::uuid, $2::uuid, $3, $4, 'approved'::graph_review_state)
         ON CONFLICT (from_id, to_id, edge_type) WHERE superseded_at IS NULL DO NOTHING`,
        [fromId, toId, edge.edgeType, edge.confidence]
      );
    }
  })().finally(() => {
    global.__graphSeedPromise = undefined;
  });

  return global.__graphSeedPromise;
}
