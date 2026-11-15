import { dbQuery, toUuid } from "../database/client";
import type {
  ArmoryPipelineCard,
  CompetitorCoverageItem,
  CreatorDashboardData,
  EgoGraphData,
  TrendGapItem,
} from "../types";

/**
 * Widget 1: Trend-Gap Detector
 * Finds Concepts touched by sources within the last `windowDays` that have no Armory idea linked.
 */
export async function getTrendGapWidget(
  windowDays = 14,
  minSources = 1
): Promise<TrendGapItem[]> {
  const res = await dbQuery<{
    concept_id: string;
    concept_title: string;
    recent_sources: number;
    updated_at: string;
    source_titles: string[];
  }>(
    `WITH concept_nodes AS (
       SELECT id, title, updated_at
         FROM graph_nodes
        WHERE kind = 'concept' AND merged_into_id IS NULL
     ),
     covered_concepts AS (
       SELECT DISTINCT
              CASE WHEN e.from_id = i.id THEN e.to_id ELSE e.from_id END AS concept_id
         FROM graph_nodes i
         JOIN graph_edges e
           ON (e.from_id = i.id OR e.to_id = i.id)
          AND e.superseded_at IS NULL
        WHERE i.kind = 'idea'
           OR (i.kind = 'source' AND 'our-video' = ANY(i.tags))
     ),
     recent_touches AS (
       SELECT c.id AS concept_id,
              c.title AS concept_title,
              c.updated_at,
              COUNT(DISTINCT s.id)::int AS recent_sources,
              ARRAY_AGG(DISTINCT s.title) AS source_titles
         FROM concept_nodes c
         JOIN graph_edges e
           ON (e.from_id = c.id OR e.to_id = c.id)
          AND e.superseded_at IS NULL
         JOIN graph_nodes s
           ON s.id = (CASE WHEN e.from_id = c.id THEN e.to_id ELSE e.from_id END)
        WHERE s.kind = 'source'
          AND s.updated_at >= NOW() - ($1::int * INTERVAL '1 day')
          AND c.id NOT IN (SELECT concept_id FROM covered_concepts)
        GROUP BY c.id, c.title, c.updated_at
       HAVING COUNT(DISTINCT s.id) >= $2::int
     )
     SELECT concept_id,
            concept_title,
            recent_sources,
            updated_at::text,
            source_titles
       FROM recent_touches
      ORDER BY recent_sources DESC, updated_at DESC`,
    [windowDays, minSources]
  );

  return res.rows.map((r) => ({
    conceptId: r.concept_id,
    conceptTitle: r.concept_title,
    recentSourceCount: r.recent_sources,
    lastUpdated: r.updated_at,
    supportingSources: r.source_titles || [],
  }));
}

/**
 * Widget 2: Competitor Coverage Matrix
 */
export async function getCompetitorCoverageMatrix(): Promise<
  CompetitorCoverageItem[]
> {
  const res = await dbQuery<{
    channel_id: string;
    channel_title: string;
    url: string | null;
    summaries_logged: number;
    topics_covered: string[] | null;
  }>(
    `SELECT ch.id AS channel_id,
            ch.title AS channel_title,
            ch.props->>'url' AS url,
            COUNT(DISTINCT s.id)::int AS summaries_logged,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT topic.title), NULL) AS topics_covered
       FROM graph_nodes ch
       LEFT JOIN graph_edges e1
         ON (e1.from_id = ch.id OR e1.to_id = ch.id)
        AND e1.superseded_at IS NULL
       LEFT JOIN graph_nodes s
         ON s.id = (CASE WHEN e1.from_id = ch.id THEN e1.to_id ELSE e1.from_id END)
        AND s.kind = 'source'
       LEFT JOIN graph_edges e2
         ON (e2.from_id = s.id OR e2.to_id = s.id)
        AND e2.superseded_at IS NULL
       LEFT JOIN graph_nodes topic
         ON topic.id = (CASE WHEN e2.from_id = s.id THEN e2.to_id ELSE e2.from_id END)
        AND topic.kind = 'concept'
      WHERE ch.kind = 'entity'
        AND ch.merged_into_id IS NULL
        AND ('competitor' = ANY(ch.tags) OR ch.props->>'entity_kind' = 'channel')
      GROUP BY ch.id, ch.title, ch.props
      ORDER BY summaries_logged DESC, ch.title ASC`
  );

  return res.rows.map((r) => ({
    channelId: r.channel_id,
    channelTitle: r.channel_title,
    handleOrUrl: r.url || "",
    summariesLogged: r.summaries_logged,
    topicsCovered: r.topics_covered || [],
  }));
}

/**
 * Widget 3: Creator Pipeline Board (Idea -> Researching -> Scripted -> Published)
 */
export async function getCreatorPipelineBoard(): Promise<ArmoryPipelineCard[]> {
  const res = await dbQuery<{
    id: string;
    title: string;
    status: string | null;
    hook: string | null;
    summary: string;
    updated_at: string;
  }>(
    `SELECT id,
            title,
            LOWER(COALESCE(props->>'status', 'idea')) AS status,
            COALESCE(NULLIF(props->>'hook', ''), summary) AS hook,
            summary,
            updated_at::text
       FROM graph_nodes
      WHERE kind = 'idea' AND merged_into_id IS NULL
      ORDER BY updated_at DESC`
  );

  return res.rows.map((r) => {
    const validStatus = ["idea", "researching", "scripted", "published"].includes(
      r.status || ""
    )
      ? (r.status as ArmoryPipelineCard["status"])
      : "idea";

    return {
      ideaId: r.id,
      title: r.title,
      status: validStatus,
      hook: r.hook || r.summary,
      updatedAt: r.updated_at,
    };
  });
}

export async function getCreatorDashboardData(): Promise<CreatorDashboardData> {
  const [trendGaps, competitors, pipeline, countsRes, edgeRes] =
    await Promise.all([
      getTrendGapWidget(14, 1),
      getCompetitorCoverageMatrix(),
      getCreatorPipelineBoard(),
      dbQuery<{
        total_nodes: number;
        vault_notes: number;
        concepts: number;
        entities: number;
        sources: number;
        doctrines: number;
        ideas: number;
      }>(
        `SELECT COUNT(*)::int AS total_nodes,
                COUNT(*) FILTER (WHERE vault_path IS NOT NULL)::int AS vault_notes,
                COUNT(*) FILTER (WHERE kind = 'concept')::int AS concepts,
                COUNT(*) FILTER (WHERE kind = 'entity')::int AS entities,
                COUNT(*) FILTER (WHERE kind = 'source')::int AS sources,
                COUNT(*) FILTER (WHERE kind = 'doctrine')::int AS doctrines,
                COUNT(*) FILTER (WHERE kind = 'idea')::int AS ideas
           FROM graph_nodes
          WHERE merged_into_id IS NULL`
      ),
      dbQuery<{ total_edges: number }>(
        `SELECT COUNT(*)::int AS total_edges
           FROM graph_edges
          WHERE superseded_at IS NULL AND review_state <> 'rejected'`
      ),
    ]);

  const c = countsRes.rows[0];
  return {
    trendGaps,
    competitors,
    pipeline,
    counts: {
      totalNodes: c?.total_nodes ?? 0,
      vaultNotes: c?.vault_notes ?? 0,
      concepts: c?.concepts ?? 0,
      entities: c?.entities ?? 0,
      sources: c?.sources ?? 0,
      doctrines: c?.doctrines ?? 0,
      ideas: c?.ideas ?? 0,
      edges: edgeRes.rows[0]?.total_edges ?? 0,
    },
  };
}

/**
 * Widget 4: Filtered 1-2 Hop Ego-Graph (Prevents Graph Hairball)
 */
export async function getFilteredEgoGraph(
  centerNodeId?: string | null,
  maxHops = 2
): Promise<EgoGraphData> {
  const safeHops = Math.min(3, Math.max(1, maxHops));
  let resolvedCenter = centerNodeId ? toUuid(centerNodeId) : null;

  if (!resolvedCenter) {
    const topRes = await dbQuery<{ id: string }>(
      `SELECT n.id
         FROM graph_nodes n
         LEFT JOIN graph_edges e
           ON (e.from_id = n.id OR e.to_id = n.id)
          AND e.superseded_at IS NULL
        WHERE n.merged_into_id IS NULL
        GROUP BY n.id, n.is_key_anchor, n.updated_at
        ORDER BY n.is_key_anchor DESC, COUNT(e.id) DESC, n.updated_at DESC
        LIMIT 1`
    );
    resolvedCenter = topRes.rows[0]?.id ?? null;
  }

  if (!resolvedCenter) {
    return { centerId: null, hops: safeHops, nodes: [], edges: [] };
  }

  const nodesRes = await dbQuery<{
    id: string;
    title: string;
    kind: string;
    cluster: string;
    vault_path: string | null;
    hop_distance: number;
  }>(
    `WITH RECURSIVE ego AS (
       SELECT id, 0 AS hop
         FROM graph_nodes
        WHERE id = $1::uuid AND merged_into_id IS NULL
       UNION
       SELECT CASE WHEN e.from_id = ego.id THEN e.to_id ELSE e.from_id END AS id,
              ego.hop + 1 AS hop
         FROM ego
         JOIN graph_edges e
           ON (e.from_id = ego.id OR e.to_id = ego.id)
          AND e.superseded_at IS NULL
          AND e.review_state <> 'rejected'
        WHERE ego.hop < $2::int
     ),
     dedup_ego AS (
       SELECT id, MIN(hop)::int AS hop_distance
         FROM ego
        GROUP BY id
     )
     SELECT n.id, n.title, n.kind::text AS kind, n.cluster, n.vault_path, d.hop_distance
       FROM dedup_ego d
       JOIN graph_nodes n ON n.id = d.id
      WHERE n.merged_into_id IS NULL
      ORDER BY d.hop_distance ASC, n.title ASC`,
    [resolvedCenter, safeHops]
  );

  const nodeIds = nodesRes.rows.map((n) => n.id);
  if (nodeIds.length === 0) {
    return { centerId: resolvedCenter, hops: safeHops, nodes: [], edges: [] };
  }

  const edgesRes = await dbQuery<{
    id: string;
    from_id: string;
    to_id: string;
    edge_type: string;
    confidence: number;
  }>(
    `SELECT id, from_id, to_id, edge_type, confidence
       FROM graph_edges
      WHERE superseded_at IS NULL
        AND review_state <> 'rejected'
        AND from_id = ANY($1::uuid[])
        AND to_id = ANY($1::uuid[])`,
    [nodeIds]
  );

  return {
    centerId: resolvedCenter,
    hops: safeHops,
    nodes: nodesRes.rows.map((n) => ({
      id: n.id,
      title: n.title,
      kind: n.kind,
      cluster: n.cluster,
      vaultPath: n.vault_path,
      hopDistance: n.hop_distance,
    })),
    edges: edgesRes.rows.map((e) => ({
      id: e.id,
      fromId: e.from_id,
      toId: e.to_id,
      edgeType: e.edge_type,
      confidence: e.confidence,
    })),
  };
}
