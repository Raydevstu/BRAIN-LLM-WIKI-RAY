import { GoogleGenAI, Type } from "@google/genai";
import { dbQuery } from "../database/client";
import type { WikiDigestResult } from "../types";

function synthesizeLocalWikiDigest(
  rawNote: string,
  existingCategories: string[] = [
    "General",
    "Research",
    "Engineering",
    "Meetings",
    "Projects",
  ]
): WikiDigestResult {
  const content = rawNote || "";
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  let title = "Synthesized Knowledge Node";
  for (const l of lines) {
    if (l.startsWith("#")) {
      const clean = l.replace(/^#+\s*/, "").replace(/[*`_]/g, "").trim();
      if (clean) {
        title = clean;
        break;
      }
    }
  }
  if (title === "Synthesized Knowledge Node" && lines.length > 0) {
    title = lines[0].replace(/[*`_#]/g, "").slice(0, 60).trim();
  }

  const lower = content.toLowerCase();
  const category =
    existingCategories.find((c) => lower.includes(c.toLowerCase())) ||
    existingCategories[0] ||
    "General";

  const bodyLines = lines.filter((l) => !l.startsWith("#") && l.length > 10);
  const summary =
    bodyLines.slice(0, 2).join(" ") || `${title} indexed in knowledge graph.`;

  const hashtags = Array.from(content.matchAll(/#([a-zA-Z0-9_-]+)/g)).map(
    (m) => m[1]
  );
  const wikilinks = Array.from(content.matchAll(/\[\[([^\]]+)\]\]/g)).map(
    (m) => m[1].trim()
  );
  const tags = Array.from(
    new Set([...hashtags, category.toLowerCase().replace(/\s+/g, "-")])
  ).slice(0, 5);

  const connectedConcepts = Array.from(new Set(wikilinks)).slice(0, 6);
  const fullMarkdown = content.includes("# ")
    ? content
    : `# ${title}\n\n${content}${
        connectedConcepts.length
          ? `\n\n## Cross-References\n${connectedConcepts
              .map((c) => `- [[${c}]]`)
              .join("\n")}`
          : ""
      }`;

  const importance: WikiDigestResult["importance"] =
    lower.includes("critical") || lower.includes("urgent") ? "High" : "Medium";

  return {
    title,
    category,
    summary,
    fullMarkdown,
    tags,
    connectedConcepts,
    importance,
  };
}

export async function generateWikiDigest(
  rawNote: string,
  existingCategories?: string[]
): Promise<WikiDigestResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
      const prompt = `Analyze this raw note and structure it into a knowledge graph node with cross-reference topics.
Categories: ${JSON.stringify(
        existingCategories || ["General", "Research", "Engineering", "Projects"]
      )}

Raw Note:
${rawNote}`;

      const response = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              category: { type: Type.STRING },
              summary: { type: Type.STRING },
              fullMarkdown: { type: Type.STRING },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              connectedConcepts: { type: Type.ARRAY, items: { type: Type.STRING } },
              importance: { type: Type.STRING },
            },
            required: [
              "title",
              "category",
              "summary",
              "fullMarkdown",
              "tags",
              "connectedConcepts",
            ],
          },
        },
      });

      const parsed = JSON.parse(response.text || "{}") as WikiDigestResult;
      if (parsed.title) return parsed;
    } catch {
      // Fall through to deterministic digest
    }
  }
  return synthesizeLocalWikiDigest(rawNote, existingCategories);
}

export async function generateNodeContextAnswer(
  nodeId: string,
  question: string
): Promise<{ answer: string; model: string }> {
  const contextRes = await dbQuery<{
    id: string;
    title: string;
    kind: string;
    summary: string;
    content: string;
    depth: number;
  }>(
    `SELECT n.id, n.title, n.kind::text AS kind, n.summary, n.content, gn.depth
       FROM graph_neighbors($1::uuid, 1) gn
       JOIN graph_nodes n ON n.id = gn.node_id
      ORDER BY gn.depth ASC, n.updated_at DESC
      LIMIT 12`,
    [nodeId]
  );

  const primary = contextRes.rows.find((r) => r.depth === 0);
  const neighbors = contextRes.rows.filter((r) => r.depth > 0);
  const contextBlock = contextRes.rows
    .map(
      (r) =>
        `[${r.depth === 0 ? "FOCUS NODE" : "CONNECTED NODE"} | ${r.kind}] ${
          r.title
        }\nSummary: ${r.summary}\n${r.content.slice(0, 1200)}`
    )
    .join("\n\n---\n\n");

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });
      const res = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: question,
        config: {
          systemInstruction: `You are a Knowledge Graph Assistant. Answer accurately using the focus node and its connected graph neighbors.\n\nGRAPH CONTEXT:\n${contextBlock}`,
        },
      });
      if (res.text) {
        return { answer: res.text, model: "gemini-4-hydrogen" };
      }
    } catch {
      // Fall through to grounded local context summary
    }
  }

  return {
    answer: primary
      ? `${primary.title}\n\n${primary.summary}\n\nConnected Graph Context (${neighbors.length} nodes):\n${neighbors
          .map((n) => `• ${n.title} (${n.kind}): ${n.summary}`)
          .join("\n")}`
      : "Node not found in graph context.",
    model: "local-graph-retrieval",
  };
}
