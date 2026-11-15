import { dbQuery, isRemotePostgresUrl } from "../database/client";
import { embedText1536 } from "./embeddings";
import type { GraphSearchCitation, GraphSearchResult } from "../types";

export async function hybridGraphSearch(
  query: string,
  limit = 15
): Promise<GraphSearchResult[]> {
  const q = query.trim();
  const safeLimit = Math.min(50, Math.max(1, limit));

  if (!q) {
    const recentRes = await dbQuery<{
      id: string;
      kind: string;
      title: string;
      summary: string;
      content: string;
    }>(
      `SELECT id, kind::text AS kind, title, summary, content
         FROM graph_nodes
        WHERE merged_into_id IS NULL
        ORDER BY updated_at DESC
        LIMIT $1`,
      [safeLimit]
    );

    return recentRes.rows.map((n, idx) => ({
      nodeId: n.id,
      kind: n.kind,
      title: n.title,
      snippet: (n.content || n.summary).slice(0, 260),
      ftsRank: idx + 1,
      vecRank: null,
      cosineSimilarity: 0,
      rrfScore: Number((1 / (60 + idx + 1)).toFixed(6)),
      citations: [
        {
          sourceId: n.id,
          title: n.title,
          locator: "line 1",
          claimText: (n.content || n.summary).slice(0, 160),
        },
      ],
    }));
  }

  const queryVec = await embedText1536(q);
  const vecParam = isRemotePostgresUrl() ? `[${queryVec.join(",")}]` : queryVec;
  const vecCast = isRemotePostgresUrl() ? "$2::vector" : "$2::real[]";

  const sql = `
    WITH raw_fts AS (
      SELECT n.id AS node_id,
             n.kind::text AS kind,
             0 AS chunk_index,
             COALESCE(NULLIF(n.content, ''), n.summary, n.title) AS chunk_text,
             n.title AS title,
             (
               ts_rank_cd(
                 to_tsvector('english', coalesce(n.title, '') || ' ' || coalesce(n.summary, '') || ' ' || coalesce(n.content, '')),
                 plainto_tsquery('english', $1)
               )
               + CASE WHEN n.title ILIKE ('%' || $1 || '%') THEN 0.85 ELSE 0.0 END
               + CASE WHEN n.content ILIKE ('%' || $1 || '%') THEN 0.45 ELSE 0.0 END
             ) AS fts_score
        FROM graph_nodes n
       WHERE n.merged_into_id IS NULL
         AND (
           to_tsvector('english', coalesce(n.title, '') || ' ' || coalesce(n.summary, '') || ' ' || coalesce(n.content, '')) @@ plainto_tsquery('english', $1)
           OR n.title ILIKE ('%' || $1 || '%')
           OR n.content ILIKE ('%' || $1 || '%')
         )

      UNION ALL

      SELECT e.node_id,
             n.kind::text AS kind,
             e.chunk_index,
             e.chunk_text,
             n.title,
             (
               ts_rank_cd(to_tsvector('english', e.chunk_text), plainto_tsquery('english', $1))
               + CASE WHEN e.chunk_text ILIKE ('%' || $1 || '%') THEN 0.5 ELSE 0.0 END
             ) AS fts_score
        FROM graph_embeddings e
        JOIN graph_nodes n ON n.id = e.node_id
       WHERE n.merged_into_id IS NULL
         AND (
           to_tsvector('english', e.chunk_text) @@ plainto_tsquery('english', $1)
           OR e.chunk_text ILIKE ('%' || $1 || '%')
         )
    ),
    fts_ranked AS (
      SELECT node_id, kind, chunk_index, chunk_text, title, fts_score,
             ROW_NUMBER() OVER (ORDER BY fts_score DESC) AS fts_rank
        FROM raw_fts
       LIMIT 50
    ),
    vec_ranked AS (
      SELECT e.node_id,
             n.kind::text AS kind,
             e.chunk_index,
             e.chunk_text,
             n.title,
             (1.0 - (e.embedding <=> ${vecCast})) AS cosine_similarity,
             ROW_NUMBER() OVER (ORDER BY (e.embedding <=> ${vecCast}) ASC) AS vec_rank
        FROM graph_embeddings e
        JOIN graph_nodes n ON n.id = e.node_id
       WHERE n.merged_into_id IS NULL
       LIMIT 50
    ),
    rrf_fused AS (
      SELECT COALESCE(f.node_id, v.node_id) AS node_id,
             COALESCE(f.kind, v.kind, 'note') AS kind,
             COALESCE(f.chunk_index, v.chunk_index, 0) AS chunk_index,
             COALESCE(f.chunk_text, v.chunk_text) AS chunk_text,
             COALESCE(f.title, v.title) AS title,
             f.fts_rank,
             v.vec_rank,
             COALESCE(v.cosine_similarity, 0) AS cosine_similarity,
             (
               COALESCE(1.0 / (60.0 + f.fts_rank), 0.0) +
               COALESCE(1.0 / (60.0 + v.vec_rank), 0.0)
             ) AS rrf_score
        FROM fts_ranked f
        FULL OUTER JOIN vec_ranked v
          ON f.node_id = v.node_id AND f.chunk_index = v.chunk_index
    )
    SELECT r.node_id,
           r.kind,
           r.chunk_text,
           r.title,
           r.fts_rank::int AS fts_rank,
           r.vec_rank::int AS vec_rank,
           r.cosine_similarity,
           r.rrf_score
      FROM rrf_fused r
     ORDER BY r.rrf_score DESC
     LIMIT $3
  `;

  const res = await dbQuery<{
    node_id: string;
    kind: string;
    chunk_text: string;
    title: string;
    fts_rank: number | null;
    vec_rank: number | null;
    cosine_similarity: number;
    rrf_score: number;
  }>(sql, [q, vecParam, safeLimit]);

  const results: GraphSearchResult[] = [];
  for (const row of res.rows) {
    const claimsRes = await dbQuery<{
      source_id: string | null;
      claim_text: string;
      locator: string | null;
    }>(
      "SELECT source_id, claim_text, locator FROM graph_claims WHERE node_id = $1 LIMIT 5",
      [row.node_id]
    );

    const citations: GraphSearchCitation[] = claimsRes.rows.map((cl) => ({
      sourceId: cl.source_id || row.node_id,
      title: row.title,
      locator: cl.locator,
      claimText: cl.claim_text,
    }));

    if (citations.length === 0) {
      citations.push({
        sourceId: row.node_id,
        title: row.title,
        locator: "line 1",
        claimText: (row.chunk_text || "").slice(0, 180),
      });
    }

    results.push({
      nodeId: row.node_id,
      kind: row.kind,
      title: row.title,
      snippet: (row.chunk_text || "").slice(0, 320),
      ftsRank: row.fts_rank,
      vecRank: row.vec_rank,
      cosineSimilarity: Number(Number(row.cosine_similarity || 0).toFixed(4)),
      rrfScore: Number(Number(row.rrf_score).toFixed(6)),
      citations,
    });
  }

  return results;
}
