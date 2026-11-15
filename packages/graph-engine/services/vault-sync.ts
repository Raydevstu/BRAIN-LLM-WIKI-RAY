import fs from "node:fs";
import path from "node:path";
import { dbQuery, sha256Hex, toUuid } from "../database/client";
import { extractExplicitWikiLinks, linkAndIndexNode } from "./linker";
import type { GraphNodeKind, VaultSyncStats } from "../types";

export interface ParsedVaultNote {
  vaultPath: string;
  title: string;
  kind: GraphNodeKind;
  category: string;
  cluster: string;
  aliases: string[];
  tags: string[];
  props: Record<string, unknown>;
  body: string;
  rawContent: string;
  contentHash: string;
  isRedirect: boolean;
  redirectTarget: string | null;
}

const SYNC_FOLDERS = ["Wiki", "Doctrine", "Armory"];

function parseYamlValue(rawVal: string): unknown {
  const trimmed = rawVal.trim();
  if (!trimmed) return "";
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((item) => String(parseYamlValue(item)).trim())
      .filter(Boolean);
  }
  return trimmed;
}

export function parseFrontmatterAndBody(raw: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const yamlBlock = match[1];
  const body = match[2];
  const frontmatter: Record<string, unknown> = {};

  for (const line of yamlBlock.split(/\r?\n/)) {
    const cleaned = line.replace(/\s+#.*$/, "").trim();
    if (!cleaned) continue;
    const colonIdx = cleaned.indexOf(":");
    if (colonIdx === -1) continue;
    const key = cleaned.slice(0, colonIdx).trim();
    const val = cleaned.slice(colonIdx + 1).trim();
    frontmatter[key] = parseYamlValue(val);
  }

  return { frontmatter, body };
}

function mapVaultTypeToGraphKind(
  fmType: string,
  relPath: string
): {
  kind: GraphNodeKind;
  category: string;
  cluster: string;
} {
  const lower = (fmType || "").toLowerCase();
  if (lower === "concept" || relPath.startsWith("Wiki/Concepts/")) {
    return { kind: "concept", category: "Concept", cluster: "concepts" };
  }
  if (lower === "entity" || relPath.startsWith("Wiki/Entities/")) {
    return { kind: "entity", category: "Entity", cluster: "entities" };
  }
  if (lower === "summary" || relPath.startsWith("Wiki/Summaries/")) {
    return { kind: "source", category: "Summary", cluster: "summaries" };
  }
  if (lower === "doctrine" || relPath.startsWith("Doctrine/")) {
    return { kind: "doctrine", category: "Doctrine", cluster: "doctrine" };
  }
  if (lower === "idea" || relPath.startsWith("Armory/")) {
    return { kind: "idea", category: "Armory Idea", cluster: "armory" };
  }
  return { kind: "note", category: "Note", cluster: "general" };
}

function walkMarkdownFiles(
  dir: string,
  baseDir: string,
  out: string[] = []
): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMarkdownFiles(full, baseDir, out);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(path.relative(baseDir, full).split(path.sep).join("/"));
    }
  }
  return out;
}

export function loadVaultNotes(vaultRoot: string): ParsedVaultNote[] {
  const root = path.resolve(vaultRoot);
  const relFiles: string[] = [];
  for (const folder of SYNC_FOLDERS) {
    walkMarkdownFiles(path.join(root, folder), root, relFiles);
  }

  const notes: ParsedVaultNote[] = [];
  for (const relPath of relFiles) {
    const absPath = path.join(root, relPath);
    const rawContent = fs.readFileSync(absPath, "utf8");
    const { frontmatter, body } = parseFrontmatterAndBody(rawContent);
    const fileStem = path.basename(relPath, ".md");
    const headingMatch = body.match(/^#\s+(.+)$/m);
    const title = (headingMatch?.[1] || fileStem).trim();

    const tags = Array.isArray(frontmatter.tags)
      ? frontmatter.tags.map((t) => String(t).toLowerCase())
      : [];
    const aliases = Array.isArray(frontmatter.aliases)
      ? frontmatter.aliases.map((a) => String(a).trim()).filter(Boolean)
      : [];

    if (fileStem !== title && !aliases.includes(fileStem)) {
      aliases.push(fileStem);
    }

    const redirectMatch = body.match(/>\s*Redirect\s*->\s*\[\[([^\]]+)\]\]/i);
    const isRedirect = tags.includes("redirect") || Boolean(redirectMatch);
    const redirectTarget = redirectMatch ? redirectMatch[1].trim() : null;

    const { kind, category, cluster } = mapVaultTypeToGraphKind(
      String(frontmatter.type || ""),
      relPath
    );

    notes.push({
      vaultPath: relPath,
      title,
      kind,
      category,
      cluster,
      aliases,
      tags,
      props: frontmatter,
      body: body.trim(),
      rawContent,
      contentHash: sha256Hex(rawContent),
      isRedirect,
      redirectTarget,
    });
  }

  return notes;
}

export async function syncVaultToDatabase(
  vaultRoot = path.join(process.cwd(), "CortexVault"),
  options: { enableAiEnrichment?: boolean; exportRepoBrainPath?: string } = {}
): Promise<VaultSyncStats> {
  const resolvedRoot = path.resolve(vaultRoot);
  if (!fs.existsSync(resolvedRoot)) {
    throw new Error(`Vault directory not found at ${resolvedRoot}`);
  }

  const notes = loadVaultNotes(resolvedRoot);
  const activeNotes = notes.filter((n) => !n.isRedirect);
  const activePaths = new Set(activeNotes.map((n) => n.vaultPath));

  let embeddedNotes = 0;
  let skippedUnchanged = 0;

  const lookupMap = new Map<string, string>();

  for (const note of activeNotes) {
    const nodeId = toUuid(`vault:${note.vaultPath}`);
    lookupMap.set(note.title.toLowerCase(), nodeId);
    for (const alias of note.aliases) {
      lookupMap.set(alias.toLowerCase(), nodeId);
    }

    const existing = await dbQuery<{ content_hash: string }>(
      `SELECT content_hash FROM graph_nodes WHERE id = $1`,
      [nodeId]
    );

    const isUnchanged =
      existing.rows[0] && existing.rows[0].content_hash === note.contentHash;

    const firstParagraph =
      note.body
        .split(/\r?\n\r?\n/)
        .map((p) => p.replace(/^#+\s+.*/gm, "").trim())
        .find((p) => p.length > 20)
        ?.slice(0, 260) || note.title;

    const isAnchor =
      note.kind === "doctrine" ||
      note.kind === "idea" ||
      note.title === "CortexOS";

    await dbQuery(
      `INSERT INTO graph_nodes (
         id, vault_path, title, kind, category, cluster, summary, content,
         content_hash, aliases, tags, props, is_key_anchor, review_state, updated_at
       )
       VALUES (
         $1, $2, $3, $4::graph_node_kind, $5, $6, $7, $8,
         $9, $10::text[], $11::text[], $12::jsonb, $13, 'approved'::graph_review_state, NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         vault_path = EXCLUDED.vault_path,
         title = EXCLUDED.title,
         kind = EXCLUDED.kind,
         category = EXCLUDED.category,
         cluster = EXCLUDED.cluster,
         summary = EXCLUDED.summary,
         content = EXCLUDED.content,
         content_hash = EXCLUDED.content_hash,
         aliases = EXCLUDED.aliases,
         tags = EXCLUDED.tags,
         props = EXCLUDED.props,
         is_key_anchor = EXCLUDED.is_key_anchor,
         review_state = 'approved'::graph_review_state,
         updated_at = CASE
           WHEN graph_nodes.content_hash != EXCLUDED.content_hash THEN NOW()
           ELSE graph_nodes.updated_at
         END`,
      [
        nodeId,
        note.vaultPath,
        note.title,
        note.kind,
        note.category,
        note.cluster,
        firstParagraph,
        note.body,
        note.contentHash,
        note.aliases,
        note.tags,
        JSON.stringify(note.props),
        isAnchor,
      ]
    );

    if (isUnchanged) {
      skippedUnchanged++;
    } else {
      await linkAndIndexNode({
        nodeId,
        title: note.title,
        content: note.body,
        cluster: note.cluster,
        autoExtractLinks: Boolean(options.enableAiEnrichment),
        skipAiExtraction: !options.enableAiEnrichment,
        skipExplicitLinks: true,
      });
      embeddedNotes++;
    }
  }

  // Dedupe cleanup: remove any non-vault stub nodes colliding with vault note titles or phantom `wikilinks` stub
  await dbQuery(
    `DELETE FROM graph_nodes
      WHERE vault_path IS NULL
        AND (
          lower(title) = 'wikilinks'
          OR lower(title) = ANY($1::text[])
        )`,
    [activeNotes.map((n) => n.title.toLowerCase())]
  );

  let edgesSynced = 0;
  for (const note of activeNotes) {
    const fromId = toUuid(`vault:${note.vaultPath}`);
    const bodyLinks = extractExplicitWikiLinks(note.body);
    const sourceLinks = Array.isArray(note.props.sources)
      ? extractExplicitWikiLinks(note.props.sources.join(" "))
      : [];

    const allTargets = new Set([...bodyLinks, ...sourceLinks]);
    for (const targetName of allTargets) {
      const toId = lookupMap.get(targetName.toLowerCase());
      if (!toId || toId === fromId) continue;

      const edgeType = sourceLinks.includes(targetName)
        ? "cited_in_source"
        : "references";

      await dbQuery(
        `INSERT INTO graph_edges (from_id, to_id, edge_type, confidence, source_id, review_state)
         VALUES ($1, $2, $3, 1.0, $1, 'approved'::graph_review_state)
         ON CONFLICT (from_id, to_id, edge_type) WHERE superseded_at IS NULL
         DO UPDATE SET confidence = 1.0, review_state = 'approved'::graph_review_state`,
        [fromId, toId, edgeType]
      );
      edgesSynced++;
    }
  }

  const dbVaultNodes = await dbQuery<{ id: string; vault_path: string }>(
    `SELECT id, vault_path FROM graph_nodes WHERE vault_path IS NOT NULL`
  );
  let prunedNodes = 0;
  for (const row of dbVaultNodes.rows) {
    if (!activePaths.has(row.vault_path)) {
      await dbQuery(`DELETE FROM graph_nodes WHERE id = $1`, [row.id]);
      prunedNodes++;
    }
  }

  const exportPath =
    options.exportRepoBrainPath ||
    path.join(process.cwd(), ".cortex", "repo-brain.json");
  const packResult = await exportVaultRepoBrainJson(exportPath);

  return {
    vaultPath: resolvedRoot,
    totalNotes: activeNotes.length,
    embeddedNotes,
    skippedUnchanged,
    prunedNodes,
    edgesSynced,
    estimatedTokens: packResult.estimatedTokens,
    repoBrainPath: exportPath,
  };
}

/**
 * Exports atomic .cortex/repo-brain.json and builds a <=1500-token ContextPack
 * with weighted importance (Doctrine > Concept/Entity > Idea > Summary) + recency decay.
 */
export async function exportVaultRepoBrainJson(targetFile: string): Promise<{
  contextPack: string;
  estimatedTokens: number;
}> {
  const nodesRes = await dbQuery<{
    id: string;
    vault_path: string | null;
    title: string;
    kind: string;
    summary: string;
    aliases: string[];
    tags: string[];
    updated_at: string;
  }>(
    `SELECT id, vault_path, title, kind::text AS kind, summary, aliases, tags, updated_at::text
       FROM graph_nodes
      WHERE merged_into_id IS NULL
      ORDER BY CASE kind::text
        WHEN 'doctrine' THEN 1
        WHEN 'concept' THEN 2
        WHEN 'entity' THEN 3
        WHEN 'idea' THEN 4
        ELSE 5
      END, updated_at DESC`
  );

  const edgesRes = await dbQuery<{
    from_id: string;
    to_id: string;
    edge_type: string;
    confidence: number;
  }>(
    `SELECT from_id, to_id, edge_type, confidence
       FROM graph_edges
      WHERE superseded_at IS NULL AND review_state <> 'rejected'`
  );

  const MAX_CHARS = 5800;
  const lines: string[] = [
    "# CORTEXOS VAULT CONTEXT PACK (<=1500 TOKENS)",
    `Generated: ${new Date().toISOString()}`,
    "",
  ];
  let charCount = lines.join("\n").length;

  for (const n of nodesRes.rows) {
    const entry = `- [${n.kind.toUpperCase()}] **${n.title}**${
      n.aliases?.length ? ` (aliases: ${n.aliases.join(", ")})` : ""
    }: ${n.summary.slice(0, 180)}`;
    if (charCount + entry.length + 1 > MAX_CHARS) break;
    lines.push(entry);
    charCount += entry.length + 1;
  }

  const contextPack = lines.join("\n");
  const estimatedTokens = Math.ceil(contextPack.length / 4);

  const payload = {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    estimatedTokens,
    contextPack,
    nodes: nodesRes.rows,
    edges: edgesRes.rows,
  };

  const absTarget = path.resolve(targetFile);
  fs.mkdirSync(path.dirname(absTarget), { recursive: true });
  const tmpFile = `${absTarget}.tmp.${process.pid}`;
  fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmpFile, absTarget);

  return { contextPack, estimatedTokens };
}
