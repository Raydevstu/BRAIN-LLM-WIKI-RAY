import { GoogleGenAI, Type } from "@google/genai";
import { dbQuery, isRemotePostgresUrl, sha256Hex, toUuid } from "../database/client";
import { chunkText, EMBEDDING_MODEL, embedText1536 } from "./embeddings";
import type { GraphEdge, KnowledgeExtractionResult } from "../types";

export function computeLineLocator(rawContent: string, quote: string): string {
  const trimmedQuote = quote.trim();
  if (!trimmedQuote) return "line 1";
  const idx = rawContent.indexOf(trimmedQuote);
  if (idx !== -1) {
    const lineNum = rawContent.slice(0, idx).split("\n").length;
    return `line ${lineNum}`;
  }
  const lines = rawContent.split("\n");
  const lowerQuote = trimmedQuote.slice(0, 32).toLowerCase();
  const lineIndex = lines.findIndex((l) => l.toLowerCase().includes(lowerQuote));
  return `line ${lineIndex >= 0 ? lineIndex + 1 : 1}`;
}

function deterministicFallbackExtraction(
  title: string,
  content: string
): KnowledgeExtractionResult {
  const lines = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const wikiLinks = Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g)).map((m) =>
    m[1].trim()
  );
  const hashtags = Array.from(content.matchAll(/#([a-zA-Z0-9_-]+)/g)).map((m) =>
    m[1].toLowerCase()
  );

  const properNouns = Array.from(
    new Set(
      (
        content.match(/\b([A-Z][a-zA-Z0-9]{2,}(?:\s+[A-Z][a-zA-Z0-9]{2,})?)\b/g) ||
        []
      ).slice(0, 8)
    )
  ).filter((name) => name.toLowerCase() !== title.toLowerCase());

  const entities = properNouns.slice(0, 4).map((name) => ({
    canonicalName: name,
    entityType: "topic",
    description: `Extracted entity referenced in "${title}".`,
    aliases: [],
  }));

  const concepts = Array.from(new Set([...wikiLinks, ...hashtags]))
    .slice(0, 5)
    .map((name) => ({
      name,
      domain: "knowledge",
      summary: `Concept linked from "${title}".`,
    }));

  const relationships = [
    ...entities.map((e) => ({
      fromName: title,
      toName: e.canonicalName,
      edgeType: "mentions",
      confidence: 0.78,
    })),
    ...concepts.map((c) => ({
      fromName: title,
      toName: c.name,
      edgeType: "relates_to",
      confidence: 0.85,
    })),
  ];

  const claims = lines
    .filter((l) => !l.startsWith("#") && l.length > 20)
    .slice(0, 3)
    .map((line) => ({
      claimText: line.slice(0, 180),
      verbatimQuote: line.slice(0, 120),
      locator: computeLineLocator(content, line.slice(0, 80)),
      confidence: 0.75,
    }));

  return {
    entities,
    concepts,
    relationships,
    claims,
    summary: lines.find((l) => !l.startsWith("#"))?.slice(0, 220) || title,
    tags: hashtags.slice(0, 6),
    isFallback: true,
  };
}

export async function extractKnowledgeWithAiOrFallback(
  title: string,
  content: string
): Promise<KnowledgeExtractionResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
    return deterministicFallbackExtraction(title, content);
  }

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const prompt = `Analyze the following document and extract structured knowledge graph entities, concepts, relationships, and grounded claims.

Title: ${title}

Content:
${content.slice(0, 12000)}`;

    const res = await ai.models.generateContent({
      model: "gemini-4-hydrogen",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            tags: { type: Type.ARRAY, items: { type: Type.STRING } },
            entities: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  canonicalName: { type: Type.STRING },
                  entityType: { type: Type.STRING },
                  description: { type: Type.STRING },
                },
                required: ["canonicalName", "entityType", "description"],
              },
            },
            concepts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  domain: { type: Type.STRING },
                  summary: { type: Type.STRING },
                },
                required: ["name", "domain", "summary"],
              },
            },
            relationships: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  fromName: { type: Type.STRING },
                  toName: { type: Type.STRING },
                  edgeType: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                  evidenceQuote: { type: Type.STRING },
                },
                required: ["fromName", "toName", "edgeType", "confidence"],
              },
            },
            claims: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  claimText: { type: Type.STRING },
                  verbatimQuote: { type: Type.STRING },
                  confidence: { type: Type.NUMBER },
                },
                required: ["claimText", "verbatimQuote", "confidence"],
              },
            },
          },
          required: ["summary", "tags", "entities", "concepts", "relationships", "claims"],
        },
      },
    });

    const parsed = JSON.parse(res.text || "{}") as KnowledgeExtractionResult;
    return {
      entities: parsed.entities || [],
      concepts: parsed.concepts || [],
      relationships: parsed.relationships || [],
      claims: (parsed.claims || []).map((c) => ({
        ...c,
        locator: computeLineLocator(content, c.verbatimQuote),
      })),
      summary: parsed.summary || title,
      tags: parsed.tags || [],
      isFallback: false,
    };
  } catch {
    return deterministicFallbackExtraction(title, content);
  }
}

async function resolveOrCreateNodeByName(
  title: string,
  kind: "entity" | "concept",
  summary: string,
  cluster: string
): Promise<string> {
  const existingRes = await dbQuery<{ id: string }>(
    `SELECT id
       FROM graph_nodes
      WHERE merged_into_id IS NULL
        AND (lower(title) = lower($1) OR similarity(lower(title), lower($1)) > 0.82)
      ORDER BY similarity(lower(title), lower($1)) DESC
      LIMIT 1`,
    [title]
  );

  if (existingRes.rows[0]) {
    return existingRes.rows[0].id;
  }

  const nodeId = toUuid(`${kind}:${title.toLowerCase()}`);
  await dbQuery(
    `INSERT INTO graph_nodes (id, title, kind, category, cluster, summary, content, content_hash, review_state)
     VALUES ($1, $2, $3::graph_node_kind, $4, $5, $6, $6, $7, 'proposed'::graph_review_state)
     ON CONFLICT (id) DO NOTHING`,
    [
      nodeId,
      title,
      kind,
      kind === "entity" ? "Entity" : "Concept",
      cluster,
      summary,
      sha256Hex(`${kind}:${title}:${summary}`),
    ]
  );

  return nodeId;
}

export async function linkAndIndexNode(params: {
  nodeId: string;
  title: string;
  content: string;
  cluster: string;
  autoExtractLinks?: boolean;
}): Promise<{ createdEdges: GraphEdge[]; chunksIndexed: number }> {
  const textToEmbed = `${params.title}\n\n${params.content}`.trim();
  const chunks = chunkText(textToEmbed, 900, 150);

  await dbQuery("DELETE FROM graph_embeddings WHERE node_id = $1", [params.nodeId]);

  for (let i = 0; i < chunks.length; i++) {
    const vec = await embedText1536(chunks[i]);
    const vecParam = isRemotePostgresUrl() ? `[${vec.join(",")}]` : vec;
    const vecCast = isRemotePostgresUrl() ? "$5::vector" : "$5::real[]";

    await dbQuery(
      `INSERT INTO graph_embeddings (node_id, chunk_index, chunk_text, model, embedding)
       VALUES ($1, $2, $3, $4, ${vecCast})
       ON CONFLICT (node_id, chunk_index, model)
       DO UPDATE SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding`,
      [params.nodeId, i, chunks[i], EMBEDDING_MODEL, vecParam]
    );
  }

  const createdEdges: GraphEdge[] = [];
  if (!params.autoExtractLinks) {
    return { createdEdges, chunksIndexed: chunks.length };
  }

  const extraction = await extractKnowledgeWithAiOrFallback(
    params.title,
    params.content
  );

  const nameToId = new Map<string, string>([
    [params.title.toLowerCase(), params.nodeId],
  ]);

  for (const ent of extraction.entities) {
    const entId = await resolveOrCreateNodeByName(
      ent.canonicalName,
      "entity",
      ent.description,
      params.cluster
    );
    nameToId.set(ent.canonicalName.toLowerCase(), entId);
  }

  for (const con of extraction.concepts) {
    const conId = await resolveOrCreateNodeByName(
      con.name,
      "concept",
      con.summary,
      params.cluster
    );
    nameToId.set(con.name.toLowerCase(), conId);
  }

  for (const rel of extraction.relationships) {
    const fromId = nameToId.get(rel.fromName.toLowerCase()) || params.nodeId;
    const toId = nameToId.get(rel.toName.toLowerCase());
    if (!toId || fromId === toId) continue;

    const edgeRes = await dbQuery<{
      id: string;
      from_id: string;
      to_id: string;
      edge_type: string;
      confidence: number;
      review_state: "proposed" | "approved" | "rejected";
      created_at: string;
    }>(
      `INSERT INTO graph_edges (from_id, to_id, edge_type, confidence, source_id, review_state)
       VALUES ($1, $2, $3, $4, $5, 'proposed'::graph_review_state)
       ON CONFLICT (from_id, to_id, edge_type) WHERE superseded_at IS NULL
       DO UPDATE SET confidence = GREATEST(graph_edges.confidence, EXCLUDED.confidence)
       RETURNING id, from_id, to_id, edge_type, confidence, review_state::text, created_at::text`,
      [
        fromId,
        toId,
        rel.edgeType || "relates_to",
        Math.min(1, Math.max(0, rel.confidence || 0.8)),
        params.nodeId,
      ]
    );

    if (edgeRes.rows[0]) {
      const r = edgeRes.rows[0];
      createdEdges.push({
        id: r.id,
        fromId: r.from_id,
        toId: r.to_id,
        edgeType: r.edge_type,
        confidence: r.confidence,
        reviewState: r.review_state,
        sourceId: params.nodeId,
        createdAt: r.created_at,
      });
    }
  }

  for (const cl of extraction.claims) {
    await dbQuery(
      `INSERT INTO graph_claims (node_id, source_id, claim_text, locator, confidence, review_state)
       VALUES ($1, $1, $2, $3, $4, 'proposed'::graph_review_state)`,
      [
        params.nodeId,
        cl.claimText,
        cl.locator || "line 1",
        Math.min(1, Math.max(0, cl.confidence || 0.85)),
      ]
    );
  }

  return { createdEdges, chunksIndexed: chunks.length };
}
