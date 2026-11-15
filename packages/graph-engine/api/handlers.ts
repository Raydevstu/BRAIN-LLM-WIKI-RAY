import fs from "node:fs";
import path from "node:path";
import { dbQuery, sha256Hex, toUuid } from "../database/client";
import { linkAndIndexNode } from "../services/linker";
import { hybridGraphSearch } from "../services/search";
import { generateNodeContextAnswer, generateWikiDigest } from "../services/ai-context";
import { seedDefaultGraphIfEmpty } from "../services/seed";
import {
  getCreatorDashboardData,
  getFilteredEgoGraph,
} from "./creator-widgets";
import { syncVaultToDatabase } from "../services/vault-sync";
import {
  addResearchSource,
  getResearchStatus,
  removeResearchSource,
  runResearchPipeline,
} from "../services/research-agent";
import type {
  CreateGraphNodeInput,
  GraphEdge,
  GraphNeighbor,
  GraphNode,
  GraphSubgraph,
  KnowledgeClaim,
  LinkGraphNodesInput,
  ResearchSourceConfig,
  UpdateGraphNodeInput,
} from "../types";

export type GraphAuthGuard = (
  req: Request
) => Promise<Response | null> | Response | null;

export interface GraphApiConfig {
  requireAuth?: GraphAuthGuard;
}

function rowToGraphNode(
  row: {
    id: string;
    vault_path?: string | null;
    title: string;
    kind: GraphNode["kind"];
    category: string;
    cluster: string;
    summary: string;
    content: string;
    aliases?: string[];
    tags: string[];
    props?: Record<string, unknown>;
    is_key_anchor: boolean;
    needs_attention: boolean;
    review_state: GraphNode["reviewState"];
    pos_x: number | null;
    pos_y: number | null;
    pos_z: number | null;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
  },
  idx: number,
  total: number,
  connections: string[]
): GraphNode {
  const angle = (idx / Math.max(1, total)) * Math.PI * 2;
  const h = sha256Hex(row.id);
  const r = 70 + (parseInt(h.slice(0, 4), 16) % 95);
  const defaultY = (parseInt(h.slice(4, 8), 16) % 140) - 70;

  return {
    id: row.id,
    vaultPath: row.vault_path ?? null,
    title: row.title,
    kind: row.kind,
    category: row.category,
    cluster: row.cluster,
    summary: row.summary || row.title,
    content: row.content || row.summary || row.title,
    aliases: Array.isArray(row.aliases) ? row.aliases : [],
    tags: Array.isArray(row.tags) ? row.tags : [],
    props: row.props || {},
    connections,
    stalenessDays: Math.max(
      0,
      Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 86_400_000)
    ),
    needsAttention: Boolean(row.needs_attention),
    isKeyAnchor: Boolean(row.is_key_anchor),
    reviewState: row.review_state,
    radius:
      row.kind === "project" || row.kind === "doctrine"
        ? 8.0
        : row.is_key_anchor
        ? 6.5
        : 4.8,
    x: row.pos_x ?? Number((Math.cos(angle) * r).toFixed(2)),
    y: row.pos_y ?? Number(defaultY.toFixed(2)),
    z: row.pos_z ?? Number((Math.sin(angle) * r).toFixed(2)),
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createGraphApiHandlers(config: GraphApiConfig = {}) {
  const guard = async (req: Request): Promise<Response | null> => {
    if (!config.requireAuth) return null;
    return await config.requireAuth(req);
  };

  async function getGraph(rootId?: string, depth = 2): Promise<Response> {
    try {
      await seedDefaultGraphIfEmpty();

      const maxDepth = Math.min(5, Math.max(1, depth));
      let resolvedRoot: string | null = null;
      let neighbors: GraphNeighbor[] = [];

      if (rootId && rootId !== "all" && rootId !== "root") {
        resolvedRoot = toUuid(rootId);
        const neighRes = await dbQuery<{
          node_id: string;
          depth: number;
          kind: string;
          title: string;
        }>(
          `SELECT gn.node_id, gn.depth, n.kind::text AS kind, n.title
             FROM graph_neighbors($1::uuid, $2::integer) gn
             JOIN graph_nodes n ON n.id = gn.node_id
            ORDER BY gn.depth ASC, n.title ASC`,
          [resolvedRoot, maxDepth]
        );
        neighbors = neighRes.rows.map((r) => ({
          nodeId: r.node_id,
          depth: Number(r.depth),
          kind: r.kind,
          title: r.title,
        }));
      }

      const nodesRes = await dbQuery<{
        id: string;
        vault_path: string | null;
        title: string;
        kind: GraphNode["kind"];
        category: string;
        cluster: string;
        summary: string;
        content: string;
        aliases: string[];
        tags: string[];
        props: Record<string, unknown>;
        is_key_anchor: boolean;
        needs_attention: boolean;
        review_state: GraphNode["reviewState"];
        pos_x: number | null;
        pos_y: number | null;
        pos_z: number | null;
        metadata: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, vault_path, title, kind::text AS kind, category, cluster, summary, content,
                aliases, tags, props, is_key_anchor, needs_attention, review_state::text AS review_state,
                pos_x, pos_y, pos_z, metadata, created_at::text, updated_at::text
           FROM graph_nodes
          WHERE merged_into_id IS NULL
          ORDER BY created_at ASC`
      );

      const edgesRes = await dbQuery<{
        id: string;
        from_id: string;
        to_id: string;
        edge_type: string;
        confidence: number;
        review_state: GraphEdge["reviewState"];
        source_id: string | null;
        metadata: Record<string, unknown>;
        created_at: string;
      }>(
        `SELECT id, from_id, to_id, edge_type, confidence, review_state::text AS review_state,
                source_id, metadata, created_at::text
           FROM graph_edges
          WHERE superseded_at IS NULL AND review_state <> 'rejected'
          ORDER BY created_at ASC`
      );

      const adj = new Map<string, Set<string>>();
      const edges: GraphEdge[] = edgesRes.rows.map((r) => {
        if (!adj.has(r.from_id)) adj.set(r.from_id, new Set());
        if (!adj.has(r.to_id)) adj.set(r.to_id, new Set());
        adj.get(r.from_id)!.add(r.to_id);
        adj.get(r.to_id)!.add(r.from_id);
        return {
          id: r.id,
          fromId: r.from_id,
          toId: r.to_id,
          edgeType: r.edge_type,
          confidence: r.confidence,
          reviewState: r.review_state,
          sourceId: r.source_id,
          metadata: r.metadata,
          createdAt: r.created_at,
        };
      });

      const nodes = nodesRes.rows.map((r, i) =>
        rowToGraphNode(r, i, nodesRes.rows.length, Array.from(adj.get(r.id) || []))
      );

      const payload: GraphSubgraph = {
        rootId: resolvedRoot,
        maxDepth,
        nodes,
        edges,
        neighbors,
      };
      return Response.json(payload);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function createNode(req: Request): Promise<Response> {
    const authErr = await guard(req);
    if (authErr) return authErr;

    try {
      const body = (await req.json()) as CreateGraphNodeInput;
      const title = String(body.title || "").trim();
      if (!title) {
        return Response.json({ error: "title is required" }, { status: 422 });
      }

      const kind = body.kind || "note";
      const category = body.category || "Note";
      const cluster = body.cluster || "general";
      const summary = body.summary ?? "";
      const content = body.content ?? summary;
      const tags = Array.isArray(body.tags) ? body.tags : [];
      const id = body.id ? toUuid(body.id) : undefined;
      const hash = sha256Hex(`${title}\n${content}`);

      const ins = await dbQuery<{
        id: string;
        title: string;
        kind: GraphNode["kind"];
        category: string;
        cluster: string;
        summary: string;
        content: string;
        tags: string[];
        is_key_anchor: boolean;
        needs_attention: boolean;
        review_state: GraphNode["reviewState"];
        pos_x: number | null;
        pos_y: number | null;
        pos_z: number | null;
        metadata: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>(
        `INSERT INTO graph_nodes (
           id, title, kind, category, cluster, summary, content, content_hash,
           tags, is_key_anchor, pos_x, pos_y, pos_z, metadata
         )
         VALUES (
           COALESCE($1::uuid, gen_random_uuid()), $2, $3::graph_node_kind, $4, $5, $6, $7, $8,
           $9::text[], $10, $11, $12, $13, $14::jsonb
         )
         RETURNING id, title, kind::text AS kind, category, cluster, summary, content, tags,
                   is_key_anchor, needs_attention, review_state::text AS review_state,
                   pos_x, pos_y, pos_z, metadata, created_at::text, updated_at::text`,
        [
          id ?? null,
          title,
          kind,
          category,
          cluster,
          summary,
          content,
          hash,
          tags,
          Boolean(body.isKeyAnchor),
          body.x ?? null,
          body.y ?? null,
          body.z ?? null,
          JSON.stringify(body.metadata || {}),
        ]
      );

      const createdRow = ins.rows[0];
      const { createdEdges, chunksIndexed } = await linkAndIndexNode({
        nodeId: createdRow.id,
        title: createdRow.title,
        content: createdRow.content || createdRow.summary,
        cluster: createdRow.cluster,
        autoExtractLinks: body.autoExtractLinks ?? true,
      });

      const node = rowToGraphNode(
        createdRow,
        0,
        1,
        createdEdges.map((e) => (e.fromId === createdRow.id ? e.toId : e.fromId))
      );

      return Response.json({ node, createdEdges, chunksIndexed }, { status: 201 });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function updateNode(req: Request, id: string): Promise<Response> {
    const authErr = await guard(req);
    if (authErr) return authErr;

    try {
      const uuid = toUuid(id);
      const body = (await req.json()) as UpdateGraphNodeInput;
      const existingRes = await dbQuery<{
        id: string;
        title: string;
        content: string;
        cluster: string;
      }>("SELECT id, title, content, cluster FROM graph_nodes WHERE id = $1 LIMIT 1", [
        uuid,
      ]);
      if (!existingRes.rows[0]) {
        return Response.json({ error: "Node not found" }, { status: 404 });
      }

      const updatedRes = await dbQuery<{
        id: string;
        title: string;
        kind: GraphNode["kind"];
        category: string;
        cluster: string;
        summary: string;
        content: string;
        tags: string[];
        is_key_anchor: boolean;
        needs_attention: boolean;
        review_state: GraphNode["reviewState"];
        pos_x: number | null;
        pos_y: number | null;
        pos_z: number | null;
        metadata: Record<string, unknown>;
        created_at: string;
        updated_at: string;
      }>(
        `UPDATE graph_nodes
            SET title = COALESCE($2, title),
                kind = COALESCE($3::graph_node_kind, kind),
                category = COALESCE($4, category),
                cluster = COALESCE($5, cluster),
                summary = COALESCE($6, summary),
                content = COALESCE($7, content),
                tags = COALESCE($8::text[], tags),
                is_key_anchor = COALESCE($9, is_key_anchor),
                needs_attention = COALESCE($10, needs_attention),
                review_state = COALESCE($11::graph_review_state, review_state),
                pos_x = COALESCE($12, pos_x),
                pos_y = COALESCE($13, pos_y),
                pos_z = COALESCE($14, pos_z),
                metadata = COALESCE($15::jsonb, metadata)
          WHERE id = $1
          RETURNING id, title, kind::text AS kind, category, cluster, summary, content, tags,
                    is_key_anchor, needs_attention, review_state::text AS review_state,
                    pos_x, pos_y, pos_z, metadata, created_at::text, updated_at::text`,
        [
          uuid,
          body.title ?? null,
          body.kind ?? null,
          body.category ?? null,
          body.cluster ?? null,
          body.summary ?? null,
          body.content ?? null,
          body.tags ?? null,
          body.isKeyAnchor ?? null,
          body.needsAttention ?? null,
          body.reviewState ?? null,
          body.x ?? null,
          body.y ?? null,
          body.z ?? null,
          body.metadata ? JSON.stringify(body.metadata) : null,
        ]
      );

      const row = updatedRes.rows[0];
      if (
        body.content !== undefined ||
        body.title !== undefined ||
        body.summary !== undefined
      ) {
        await linkAndIndexNode({
          nodeId: row.id,
          title: row.title,
          content: row.content || row.summary,
          cluster: row.cluster,
          autoExtractLinks: false,
        });
      }

      const relsRes = await dbQuery<{ from_id: string; to_id: string }>(
        "SELECT from_id, to_id FROM graph_edges WHERE (from_id = $1 OR to_id = $1) AND superseded_at IS NULL",
        [row.id]
      );
      const conns = relsRes.rows.map((r) =>
        r.from_id === row.id ? r.to_id : r.from_id
      );

      return Response.json({ node: rowToGraphNode(row, 0, 1, conns) });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function deleteNode(req: Request, id: string): Promise<Response> {
    const authErr = await guard(req);
    if (authErr) return authErr;

    try {
      const uuid = toUuid(id);
      await dbQuery("DELETE FROM graph_nodes WHERE id = $1", [uuid]);
      return Response.json({ deleted: true, id: uuid });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function linkNodes(req: Request): Promise<Response> {
    const authErr = await guard(req);
    if (authErr) return authErr;

    try {
      const body = (await req.json()) as LinkGraphNodesInput;
      const fromId = toUuid(body.fromId);
      const toId = toUuid(body.toId);
      if (!fromId || !toId || fromId === toId) {
        return Response.json(
          { error: "Distinct fromId and toId are required" },
          { status: 422 }
        );
      }

      const edgeRes = await dbQuery<{
        id: string;
        from_id: string;
        to_id: string;
        edge_type: string;
        confidence: number;
        review_state: GraphEdge["reviewState"];
        source_id: string | null;
        created_at: string;
      }>(
        `INSERT INTO graph_edges (from_id, to_id, edge_type, confidence, source_id, review_state, metadata)
         VALUES ($1, $2, $3, $4, $5, 'approved'::graph_review_state, $6::jsonb)
         ON CONFLICT (from_id, to_id, edge_type) WHERE superseded_at IS NULL
         DO UPDATE SET confidence = EXCLUDED.confidence, review_state = 'approved'::graph_review_state
         RETURNING id, from_id, to_id, edge_type, confidence, review_state::text AS review_state, source_id, created_at::text`,
        [
          fromId,
          toId,
          body.edgeType || "relates_to",
          body.confidence ?? 1.0,
          body.sourceId ? toUuid(body.sourceId) : null,
          JSON.stringify(body.metadata || {}),
        ]
      );

      const r = edgeRes.rows[0];
      return Response.json(
        {
          edge: {
            id: r.id,
            fromId: r.from_id,
            toId: r.to_id,
            edgeType: r.edge_type,
            confidence: r.confidence,
            reviewState: r.review_state,
            sourceId: r.source_id,
            createdAt: r.created_at,
          },
        },
        { status: 201 }
      );
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function unlinkEdge(req: Request, edgeId: string): Promise<Response> {
    const authErr = await guard(req);
    if (authErr) return authErr;

    try {
      await dbQuery("UPDATE graph_edges SET superseded_at = now() WHERE id = $1", [
        toUuid(edgeId),
      ]);
      return Response.json({ deleted: true, id: edgeId });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function search(req: Request): Promise<Response> {
    try {
      await seedDefaultGraphIfEmpty();
      const url = new URL(req.url);
      const q = url.searchParams.get("q") || "";
      const limit = parseInt(url.searchParams.get("limit") || "15", 10);
      const results = await hybridGraphSearch(q, limit);
      return Response.json({ query: q, results });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function getNodeClaims(nodeId: string): Promise<Response> {
    try {
      const uuid = toUuid(nodeId);
      const claimsRes = await dbQuery<{
        id: string;
        node_id: string;
        claim_text: string;
        source_id: string | null;
        locator: string | null;
        confidence: number;
        review_state: KnowledgeClaim["reviewState"];
        created_at: string;
      }>(
        `SELECT id, node_id, claim_text, source_id, locator, confidence,
                review_state::text AS review_state, created_at::text
           FROM graph_claims
          WHERE node_id = $1
          ORDER BY confidence DESC, created_at DESC`,
        [uuid]
      );

      const claims: KnowledgeClaim[] = claimsRes.rows.map((r) => ({
        id: r.id,
        nodeId: r.node_id,
        claimText: r.claim_text,
        sourceId: r.source_id,
        locator: r.locator,
        confidence: r.confidence,
        reviewState: r.review_state,
        createdAt: r.created_at,
      }));
      return Response.json({ claims });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function askNodeContext(req: Request, nodeId: string): Promise<Response> {
    try {
      const body = (await req.json()) as { question?: string };
      const question = String(body.question || "").trim();
      if (!question) {
        return Response.json({ error: "question is required" }, { status: 422 });
      }
      const res = await generateNodeContextAnswer(toUuid(nodeId), question);
      return Response.json(res);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function digestNote(req: Request): Promise<Response> {
    try {
      const body = (await req.json()) as {
        rawNote?: string;
        categories?: string[];
      };
      const digest = await generateWikiDigest(body.rawNote || "", body.categories);
      return Response.json(digest);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function getEgoGraph(req: Request): Promise<Response> {
    try {
      await seedDefaultGraphIfEmpty();
      const url = new URL(req.url);
      const nodeId = url.searchParams.get("nodeId") || url.searchParams.get("node_id");
      const hops = parseInt(url.searchParams.get("hops") || "2", 10);
      const data = await getFilteredEgoGraph(nodeId, Number.isFinite(hops) ? hops : 2);
      return Response.json(data);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function getCreatorStats(): Promise<Response> {
    try {
      await seedDefaultGraphIfEmpty();
      const stats = await getCreatorDashboardData();
      return Response.json(stats);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function syncVault(req: Request): Promise<Response> {
    const authErr = await guard(req);
    if (authErr) return authErr;

    try {
      let body: { vaultPath?: string; enableAiEnrichment?: boolean } = {};
      try {
        body = (await req.json()) as {
          vaultPath?: string;
          enableAiEnrichment?: boolean;
        };
      } catch {
        // Empty JSON body is fine
      }
      const vaultDir =
        body.vaultPath?.trim() || path.join(process.cwd(), "CortexVault");
      const stats = await syncVaultToDatabase(vaultDir, {
        enableAiEnrichment: Boolean(body.enableAiEnrichment),
        exportRepoBrainPath: path.join(process.cwd(), ".cortex", "repo-brain.json"),
      });
      return Response.json(stats);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function getVaultBrainStatus(): Promise<Response> {
    try {
      const vaultDir = path.join(process.cwd(), "CortexVault");
      const repoBrainFile = path.join(process.cwd(), ".cortex", "repo-brain.json");
      const vaultExists = fs.existsSync(vaultDir);
      let repoBrain: {
        generatedAt?: string;
        estimatedTokens?: number;
        contextPack?: string;
      } | null = null;
      if (fs.existsSync(repoBrainFile)) {
        try {
          repoBrain = JSON.parse(fs.readFileSync(repoBrainFile, "utf8"));
        } catch {
          repoBrain = null;
        }
      }
      return Response.json({
        vaultExists,
        vaultDir,
        hasRepoBrain: Boolean(repoBrain),
        generatedAt: repoBrain?.generatedAt || null,
        estimatedTokens: repoBrain?.estimatedTokens || 0,
        contextPack: repoBrain?.contextPack || "",
      });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function getResearch(): Promise<Response> {
    try {
      return Response.json(getResearchStatus());
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  async function runResearch(req: Request): Promise<Response> {
    const authErr = await guard(req);
    if (authErr) return authErr;

    try {
      const body = (await req.json()) as {
        action?: "fetch_only" | "process_inbox" | "run_pipeline" | "add_source" | "remove_source";
        budget?: number;
        maxPerSource?: number;
        source?: ResearchSourceConfig;
        sourceName?: string;
      };
      const action = body.action || "run_pipeline";

      if (action === "add_source") {
        if (!body.source?.name || !body.source?.kind) {
          return Response.json(
            { error: "source.name and source.kind are required" },
            { status: 422 }
          );
        }
        return Response.json({ status: addResearchSource(body.source) });
      }

      if (action === "remove_source") {
        if (!body.sourceName) {
          return Response.json(
            { error: "sourceName is required" },
            { status: 422 }
          );
        }
        return Response.json({ status: removeResearchSource(body.sourceName) });
      }

      const result = await runResearchPipeline({
        mode: action,
        budget: body.budget,
        maxPerSource: body.maxPerSource,
      });
      return Response.json(result);
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  return {
    getGraph,
    createNode,
    updateNode,
    deleteNode,
    linkNodes,
    unlinkEdge,
    search,
    getNodeClaims,
    askNodeContext,
    digestNote,
    getEgoGraph,
    getCreatorStats,
    syncVault,
    getVaultBrainStatus,
    getResearch,
    runResearch,
  };
}
