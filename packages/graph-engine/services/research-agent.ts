import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, Type } from "@google/genai";
import { parseFrontmatterAndBody, syncVaultToDatabase } from "./vault-sync";
import type {
  ResearchRunReport,
  ResearchSourceConfig,
  ResearchStatusData,
  VaultSyncStats,
} from "../types";

interface FeedItem {
  id: string;
  title: string;
  url: string;
  published: string;
  summary: string;
  authors: string[];
  tags: string[];
  videoId: string;
  source: string;
  kind: "youtube" | "arxiv" | "rss";
  suggestedTags: string[];
}

interface ResearchState {
  seen: Record<string, string>;
  channels: Record<string, string>;
}

interface SourcesFile {
  vault?: string;
  budget_per_run?: number;
  max_per_source?: number;
  polite_delay_s?: number;
  http_timeout_s?: number;
  sources: ResearchSourceConfig[];
  [key: string]: unknown;
}

const SEEN_CAP = 8000;
const UA = "CortexOS-ResearchAgent/0.1 (personal knowledge vault)";
const ARXIV_API = "http://export.arxiv.org/api/query";
const YT_FEED = "https://www.youtube.com/feeds/videos.xml?channel_id=";

function getPaths() {
  const cwd = process.cwd();
  const researchDir = path.join(cwd, "CortexResearch");
  const vaultDir = path.join(cwd, "CortexVault");
  const sourcesFile = path.join(researchDir, "sources.json");
  const stateFile = path.join(researchDir, "state.json");
  const logsDir = path.join(researchDir, "logs");
  return { cwd, researchDir, vaultDir, sourcesFile, stateFile, logsDir };
}

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(
    d.getUTCHours()
  )}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

function stripHtml(input: string): string {
  return decodeXmlEntities(input)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(input: string, maxLen: number): string {
  const s = input || "";
  return s.length <= maxLen ? s : `${s.slice(0, maxLen - 1).trimEnd()}…`;
}

function parseDateIso(raw: string): string {
  if (!raw) return nowDate();
  const d = new Date(raw.trim());
  if (!Number.isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10);
  }
  return nowDate();
}

function extractTagText(block: string, tagNames: string[]): string {
  for (const tag of tagNames) {
    const escaped = tag.replace(/[:]/g, "\\:");
    const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
    const m = block.match(re);
    if (m && m[1]) {
      return decodeXmlEntities(m[1]).trim();
    }
  }
  return "";
}

export function parseFeedXml(xmlText: string): Array<{
  id: string;
  title: string;
  url: string;
  published: string;
  summary: string;
  authors: string[];
  tags: string[];
  videoId: string;
}> {
  const items: Array<{
    id: string;
    title: string;
    url: string;
    published: string;
    summary: string;
    authors: string[];
    tags: string[];
    videoId: string;
  }> = [];

  const isAtom = /<(?:[a-z0-9_-]+:)?feed[\s>]/i.test(xmlText);
  if (isAtom) {
    const entries = xmlText.match(/<(?:[a-z0-9_-]+:)?entry[\s>][\s\S]*?<\/(?:[a-z0-9_-]+:)?entry>/gi) || [];
    for (const entry of entries) {
      const id = extractTagText(entry, ["id"]);
      const title = stripHtml(extractTagText(entry, ["title"]));
      const published = parseDateIso(
        extractTagText(entry, ["published", "updated"])
      );
      const videoId = extractTagText(entry, ["yt:videoId"]);
      const summary =
        extractTagText(entry, ["summary", "content", "media:description"]) || "";

      // Resolve alternate link or first href link
      let url = "";
      const linkTags = entry.match(/<link\b[^>]*>/gi) || [];
      for (const lt of linkTags) {
        const hrefM = lt.match(/\bhref=["']([^"']+)["']/i);
        if (!hrefM) continue;
        if (!/\brel=/i.test(lt) || /\brel=["']alternate["']/i.test(lt)) {
          url = decodeXmlEntities(hrefM[1]);
          break;
        }
        if (!url) url = decodeXmlEntities(hrefM[1]);
      }

      const authors: string[] = [];
      const authorBlocks = entry.match(/<author[\s>][\s\S]*?<\/author>/gi) || [];
      for (const ab of authorBlocks) {
        const name = stripHtml(extractTagText(ab, ["name"]));
        if (name) authors.push(name);
      }

      const tags: string[] = [];
      const catTags = entry.match(/<category\b[^>]*>/gi) || [];
      for (const ct of catTags) {
        const termM = ct.match(/\bterm=["']([^"']+)["']/i);
        if (termM && termM[1]) tags.push(termM[1].trim());
      }

      items.push({
        id: id || url,
        title,
        url,
        published,
        summary: clip(stripHtml(summary), 1500),
        authors,
        tags,
        videoId,
      });
    }
    return items;
  }

  const rssItems = xmlText.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const item of rssItems) {
    const title = stripHtml(extractTagText(item, ["title"]));
    const link = stripHtml(extractTagText(item, ["link"]));
    const guid = stripHtml(extractTagText(item, ["guid"])) || link;
    const pubDate = parseDateIso(
      extractTagText(item, ["pubDate", "dc:date", "published"])
    );
    const desc = extractTagText(item, ["content:encoded", "description", "summary"]);
    const creator = stripHtml(extractTagText(item, ["dc:creator", "author"]));

    items.push({
      id: guid || link,
      title,
      url: link,
      published: pubDate,
      summary: clip(stripHtml(desc), 1500),
      authors: creator ? [creator] : [],
      tags: [],
      videoId: "",
    });
  }

  return items;
}

async function httpGetText(url: string, timeoutMs = 12000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

export function loadSourcesConfig(): SourcesFile {
  const { sourcesFile, researchDir } = getPaths();
  if (!fs.existsSync(sourcesFile)) {
    fs.mkdirSync(researchDir, { recursive: true });
    const defaults: SourcesFile = {
      vault: "../CortexVault",
      budget_per_run: 12,
      max_per_source: 5,
      sources: [
        {
          name: "Wes Roth",
          kind: "youtube",
          handle: "@WesRoth",
          priority: 1,
          tags: ["competitor-coverage", "ai-news"],
        },
        {
          name: "arXiv AI/CL/LG",
          kind: "arxiv",
          categories: ["cs.AI", "cs.CL", "cs.LG"],
          fetch: 25,
          priority: 2,
        },
        {
          name: "Google AI Blog",
          kind: "rss",
          url: "https://blog.google/technology/ai/rss/",
          priority: 3,
        },
        {
          name: "Hugging Face Blog",
          kind: "rss",
          url: "https://huggingface.co/blog/feed.xml",
          priority: 3,
        },
      ],
    };
    fs.writeFileSync(sourcesFile, JSON.stringify(defaults, null, 2), "utf8");
    return defaults;
  }
  return JSON.parse(fs.readFileSync(sourcesFile, "utf8")) as SourcesFile;
}

function saveSourcesConfig(cfg: SourcesFile): void {
  const { sourcesFile, researchDir } = getPaths();
  fs.mkdirSync(researchDir, { recursive: true });
  fs.writeFileSync(sourcesFile, JSON.stringify(cfg, null, 2), "utf8");
}

function loadState(): ResearchState {
  const { stateFile } = getPaths();
  if (fs.existsSync(stateFile)) {
    try {
      return JSON.parse(fs.readFileSync(stateFile, "utf8")) as ResearchState;
    } catch {
      return { seen: {}, channels: {} };
    }
  }
  return { seen: {}, channels: {} };
}

function saveState(state: ResearchState): void {
  const { stateFile, researchDir } = getPaths();
  fs.mkdirSync(researchDir, { recursive: true });
  const entries = Object.entries(state.seen || {});
  if (entries.length > SEEN_CAP) {
    entries.sort((a, b) => (a[1] < b[1] ? 1 : -1));
    state.seen = Object.fromEntries(entries.slice(0, SEEN_CAP));
  }
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 1), "utf8");
}

async function resolveYoutubeChannel(
  src: ResearchSourceConfig,
  state: ResearchState
): Promise<string> {
  if (src.channel_id) return src.channel_id;
  const handle = src.handle?.trim();
  if (!handle) {
    throw new Error(`YouTube source "${src.name}" needs handle or channel_id`);
  }
  if (state.channels[handle]) return state.channels[handle];

  const html = await httpGetText(
    `https://www.youtube.com/${handle.startsWith("@") ? handle : `@${handle}`}`,
    12000
  );
  const patterns = [
    /"channelId":"(UC[0-9A-Za-z_-]{22})"/,
    /"externalId":"(UC[0-9A-Za-z_-]{22})"/,
    /youtube\.com\/channel\/(UC[0-9A-Za-z_-]{22})/,
  ];
  for (const pat of patterns) {
    const m = html.match(pat);
    if (m && m[1]) {
      state.channels[handle] = m[1];
      return m[1];
    }
  }
  throw new Error(`Could not resolve channel_id for ${handle}`);
}

async function fetchSourceItems(
  src: ResearchSourceConfig,
  state: ResearchState
): Promise<FeedItem[]> {
  let rawItems: ReturnType<typeof parseFeedXml> = [];

  if (src.kind === "arxiv") {
    const cats = src.categories?.length ? src.categories : ["cs.AI", "cs.CL", "cs.LG"];
    const q = cats.map((c) => `cat:${c}`).join(" OR ");
    const params = new URLSearchParams({
      search_query: q,
      sortBy: "submittedDate",
      sortOrder: "descending",
      max_results: String(src.fetch ?? 25),
    });
    const xml = await httpGetText(`${ARXIV_API}?${params.toString()}`, 15000);
    rawItems = parseFeedXml(xml);
  } else if (src.kind === "youtube") {
    const cid = await resolveYoutubeChannel(src, state);
    const xml = await httpGetText(`${YT_FEED}${cid}`, 12000);
    rawItems = parseFeedXml(xml).map((it) => ({
      ...it,
      url: it.videoId ? `https://www.youtube.com/watch?v=${it.videoId}` : it.url,
      id: it.videoId ? `yt:${it.videoId}` : it.id,
    }));
  } else if (src.kind === "rss") {
    if (!src.url) throw new Error(`RSS source "${src.name}" missing url`);
    const xml = await httpGetText(src.url, 12000);
    rawItems = parseFeedXml(xml);
  }

  const inc = (src.include || []).map((p) => new RegExp(p, "i"));
  const exc = (src.exclude || []).map((p) => new RegExp(p, "i"));

  const out: FeedItem[] = [];
  for (const it of rawItems) {
    const text = `${it.title} ${it.summary}`;
    if (inc.length && !inc.some((p) => p.test(text))) continue;
    if (exc.some((p) => p.test(text))) continue;
    out.push({
      ...it,
      source: src.name,
      kind: src.kind,
      suggestedTags: [
        ...(src.tags || []),
        ...(src.kind === "arxiv" ? it.tags : []),
      ],
    });
  }
  return out;
}

function sanitizeFilename(s: string, limit = 105): string {
  const clean = (s || "")
    .replace(/[:/\\|?*<>"#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/, "");
  return clip(clean, limit);
}

function renderDropMarkdown(it: FeedItem): string {
  const tags = Array.from(new Set(it.suggestedTags));
  const authors = it.authors.slice(0, 12).join(", ");
  const lines = [
    "---",
    `source_url: ${it.url}`,
    `source_kind: ${it.kind}`,
    `source_name: ${JSON.stringify(it.source)}`,
    `published: ${it.published}`,
    `retrieved: ${nowDate()}`,
    `suggested_tags: [${tags.join(", ")}]`,
  ];
  if (it.kind === "youtube") {
    lines.push("coverage_hint: competitor-coverage");
  }
  if (authors) {
    lines.push(`authors: ${JSON.stringify(authors)}`);
  }
  lines.push(
    "---",
    `# ${it.title}`,
    "",
    `- Source: ${it.source} (${it.kind})`,
    `- URL: ${it.url}`,
    `- Published: ${it.published}`
  );
  if (authors) lines.push(`- Authors: ${authors}`);
  if (it.summary) {
    lines.push("", "## Abstract / description", it.summary);
  }
  lines.push(
    "",
    "## Librarian instructions",
    "Process per CLAUDE.md section 6 (Raw copy, Summary, ripple, opportunity check).",
    "If coverage_hint is competitor-coverage, also apply section 8 (creator rules).",
    ""
  );
  return lines.join("\n");
}

function listPendingInboxFiles(): string[] {
  const { vaultDir } = getPaths();
  const inboxDir = path.join(vaultDir, "Inbox");
  if (!fs.existsSync(inboxDir)) return [];
  return fs
    .readdirSync(inboxDir)
    .filter((f) => f.endsWith(".md") && !f.startsWith("."))
    .sort();
}

export function getResearchStatus(): ResearchStatusData {
  const cfg = loadSourcesConfig();
  const state = loadState();
  const { logsDir } = getPaths();

  const recentRuns: ResearchRunReport[] = [];
  if (fs.existsSync(logsDir)) {
    const files = fs
      .readdirSync(logsDir)
      .filter((f) => f.startsWith("run-") && f.endsWith(".json"))
      .sort()
      .reverse()
      .slice(0, 8);
    for (const f of files) {
      try {
        recentRuns.push(
          JSON.parse(fs.readFileSync(path.join(logsDir, f), "utf8")) as ResearchRunReport
        );
      } catch {
        // skip unreadable log
      }
    }
  }

  return {
    sources: cfg.sources || [],
    budgetPerRun: cfg.budget_per_run ?? 12,
    maxPerSource: cfg.max_per_source ?? 5,
    pendingInboxFiles: listPendingInboxFiles(),
    seenCount: Object.keys(state.seen || {}).length,
    cachedChannels: state.channels || {},
    recentRuns,
  };
}

export function addResearchSource(source: ResearchSourceConfig): ResearchStatusData {
  const cfg = loadSourcesConfig();
  const existingIdx = (cfg.sources || []).findIndex(
    (s) => s.name.toLowerCase() === source.name.trim().toLowerCase()
  );
  if (existingIdx >= 0) {
    cfg.sources[existingIdx] = source;
  } else {
    cfg.sources = [...(cfg.sources || []), source];
  }
  saveSourcesConfig(cfg);
  return getResearchStatus();
}

export function removeResearchSource(name: string): ResearchStatusData {
  const cfg = loadSourcesConfig();
  cfg.sources = (cfg.sources || []).filter(
    (s) => s.name.toLowerCase() !== name.trim().toLowerCase()
  );
  saveSourcesConfig(cfg);
  return getResearchStatus();
}

async function synthesizeInboxDrop(
  title: string,
  sourceName: string,
  url: string,
  bodyText: string,
  existingConceptTitles: string[]
): Promise<{
  summaryBullets: string[];
  concepts: string[];
  entities: string[];
  tags: string[];
  armoryHook: string | null;
}> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (apiKey && apiKey !== "MY_GEMINI_API_KEY") {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { "User-Agent": "aistudio-build" } },
      });
      const res = await ai.models.generateContent({
        model: "gemini-4-hydrogen",
        contents: `You are the CortexVault Librarian. Summarize this Inbox research drop in 3-5 concise bullets, map relevant Concepts (prefer matching existing ones when applicable), extract key Entities (companies/people/models/tools), tags, and propose an Armory YouTube video angle if notable.

Existing concepts in vault: ${existingConceptTitles.slice(0, 30).join(", ")}
Title: ${title}
Source: ${sourceName}
URL: ${url}

Content:
${bodyText.slice(0, 8000)}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summaryBullets: { type: Type.ARRAY, items: { type: Type.STRING } },
              concepts: { type: Type.ARRAY, items: { type: Type.STRING } },
              entities: { type: Type.ARRAY, items: { type: Type.STRING } },
              tags: { type: Type.ARRAY, items: { type: Type.STRING } },
              armoryHook: { type: Type.STRING },
            },
            required: ["summaryBullets", "concepts", "entities", "tags"],
          },
        },
      });
      const parsed = JSON.parse(res.text || "{}") as {
        summaryBullets?: string[];
        concepts?: string[];
        entities?: string[];
        tags?: string[];
        armoryHook?: string;
      };
      return {
        summaryBullets: (parsed.summaryBullets || []).slice(0, 5),
        concepts: (parsed.concepts || []).slice(0, 4),
        entities: (parsed.entities || []).slice(0, 4),
        tags: (parsed.tags || []).slice(0, 5),
        armoryHook: parsed.armoryHook?.trim() || null,
      };
    } catch {
      // Fallback below
    }
  }

  const lower = `${title} ${bodyText}`.toLowerCase();
  const matchedConcepts = existingConceptTitles
    .filter((c) => lower.includes(c.toLowerCase()))
    .slice(0, 4);
  if (matchedConcepts.length === 0) {
    matchedConcepts.push("AI Systems");
  }
  const cleanLines = bodyText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 25 && !l.startsWith("#") && !l.startsWith("- Source:"));
  return {
    summaryBullets:
      cleanLines.length > 0
        ? cleanLines.slice(0, 3).map((l) => clip(l, 180))
        : [`Ingested "${title}" from ${sourceName}.`],
    concepts: matchedConcepts,
    entities: sourceName ? [sourceName] : [],
    tags: ["research-drop"],
    armoryHook: null,
  };
}

function ensureConceptOrEntityNote(
  folder: "Wiki/Concepts" | "Wiki/Entities",
  name: string,
  summarySlug: string,
  isCompetitor = false
) {
  const { vaultDir } = getPaths();
  const safeName = sanitizeFilename(name, 80);
  if (!safeName) return;
  const dir = path.join(vaultDir, folder);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${safeName}.md`);
  const today = nowDate();

  if (!fs.existsSync(filePath)) {
    const type = folder === "Wiki/Concepts" ? "concept" : "entity";
    const tags = isCompetitor ? "[competitor, channel]" : "[]";
    const extra = isCompetitor ? "\nentity_kind: channel" : "";
    const content = [
      "---",
      `type: ${type}`,
      "aliases: []",
      `tags: ${tags}${extra}`,
      `created: ${today}`,
      `updated: ${today}`,
      "---",
      `# ${name}`,
      "",
      `Canonical ${type} page maintained by the CortexVault Librarian.`,
      "",
      "## Coverage & References",
      `- Mentioned in [[${summarySlug}]] (${today})`,
      "",
    ].join("\n");
    fs.writeFileSync(filePath, content, "utf8");
  } else {
    const cur = fs.readFileSync(filePath, "utf8");
    const linkToken = `[[${summarySlug}]]`;
    if (!cur.includes(linkToken)) {
      const updated = cur.replace(/updated:\s*.*/i, `updated: ${today}`);
      fs.writeFileSync(
        filePath,
        `${updated.trimEnd()}\n- Mentioned in ${linkToken} (${today})\n`,
        "utf8"
      );
    }
  }
}

export async function processVaultInbox(): Promise<{
  processedInbox: string[];
  createdSummaries: string[];
}> {
  const { vaultDir } = getPaths();
  const pending = listPendingInboxFiles();
  if (pending.length === 0) {
    return { processedInbox: [], createdSummaries: [] };
  }

  const conceptsDir = path.join(vaultDir, "Wiki", "Concepts");
  const existingConcepts = fs.existsSync(conceptsDir)
    ? fs
        .readdirSync(conceptsDir)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.replace(/\.md$/, ""))
    : [];

  const processedInbox: string[] = [];
  const createdSummaries: string[] = [];
  const today = nowDate();

  for (const filename of pending) {
    const inboxPath = path.join(vaultDir, "Inbox", filename);
    const rawContent = fs.readFileSync(inboxPath, "utf8");
    const { frontmatter, body } = parseFrontmatterAndBody(rawContent);
    const h1 = body.match(/^#\s+(.+)$/m);
    const title = (h1?.[1] || filename.replace(/\.md$/, "")).trim();
    const sourceName = String(frontmatter.source_name || "Research Feed");
    const sourceUrl = String(frontmatter.source_url || "");
    const published = String(frontmatter.published || today);
    const isCompetitor =
      String(frontmatter.coverage_hint || "") === "competitor-coverage" ||
      String(frontmatter.source_kind || "") === "youtube";

    // 1. Archive verbatim copy in Raw/
    const rawDir = path.join(vaultDir, "Raw");
    fs.mkdirSync(rawDir, { recursive: true });
    const rawRel = `Raw/${filename}`;
    fs.writeFileSync(path.join(vaultDir, rawRel), rawContent, "utf8");

    // 2. Synthesize Summary via Gemini (or deterministic fallback)
    const synth = await synthesizeInboxDrop(
      title,
      sourceName,
      sourceUrl,
      body,
      existingConcepts
    );

    const summaryBase = sanitizeFilename(`${published} - ${title}`, 95);
    const summaryRel = `Wiki/Summaries/${summaryBase}.md`;
    const allTags = Array.from(
      new Set([
        ...(Array.isArray(frontmatter.suggested_tags)
          ? frontmatter.suggested_tags.map(String)
          : []),
        ...synth.tags,
        "summary",
      ])
    );

    const conceptLinks = synth.concepts.map((c) => `[[${c}]]`);
    const entityLinks = synth.entities.map((e) => `[[${e}]]`);
    const summaryMd = [
      "---",
      "type: summary",
      "aliases: []",
      `tags: [${allTags.join(", ")}]`,
      `created: ${today}`,
      `updated: ${today}`,
      `url: ${sourceUrl}`,
      `sources: [${JSON.stringify(`[[${filename.replace(/\.md$/, "")}]]`)}]`,
      "---",
      `# ${title}`,
      "",
      `- **Source**: [[${sourceName}]] · Published ${published}`,
      sourceUrl ? `- **URL**: ${sourceUrl}` : "",
      `- **Raw Archive**: [[${filename.replace(/\.md$/, "")}]]`,
      "",
      "## Key Takeaways",
      ...synth.summaryBullets.map((b) => `- ${b}`),
      "",
      "## Connected Knowledge",
      conceptLinks.length ? `- Concepts: ${conceptLinks.join(", ")}` : "",
      entityLinks.length ? `- Entities: ${entityLinks.join(", ")}` : "",
      "",
    ]
      .filter(Boolean)
      .join("\n");

    const summaryDir = path.join(vaultDir, "Wiki", "Summaries");
    fs.mkdirSync(summaryDir, { recursive: true });
    fs.writeFileSync(path.join(vaultDir, summaryRel), summaryMd, "utf8");

    // 3. Ripple concepts & entities
    for (const c of synth.concepts) {
      ensureConceptOrEntityNote("Wiki/Concepts", c, summaryBase, false);
    }
    for (const e of synth.entities) {
      const comp =
        isCompetitor && e.toLowerCase() === sourceName.toLowerCase();
      ensureConceptOrEntityNote("Wiki/Entities", e, summaryBase, comp);
    }
    if (isCompetitor && sourceName) {
      ensureConceptOrEntityNote("Wiki/Entities", sourceName, summaryBase, true);
    }

    // 4. Optional Armory seed when notable hook proposed
    if (synth.armoryHook && synth.armoryHook.length > 18) {
      const armoryDir = path.join(vaultDir, "Armory");
      fs.mkdirSync(armoryDir, { recursive: true });
      const ideaName = sanitizeFilename(title, 75);
      const ideaPath = path.join(armoryDir, `${ideaName}.md`);
      if (!fs.existsSync(ideaPath)) {
        const ideaMd = [
          "---",
          "type: idea",
          "status: idea",
          `hook: ${JSON.stringify(synth.armoryHook)}`,
          "tags: [armory, research-seeded]",
          `created: ${today}`,
          `updated: ${today}`,
          "---",
          `# ${ideaName}`,
          "",
          `> Hook: ${synth.armoryHook}`,
          "",
          `Evidence: [[${summaryBase}]] · Concepts: ${conceptLinks.join(", ")}`,
          "",
        ].join("\n");
        fs.writeFileSync(ideaPath, ideaMd, "utf8");
      }
    }

    // 5. Remove processed drop from Inbox/
    fs.unlinkSync(inboxPath);
    processedInbox.push(filename);
    createdSummaries.push(summaryRel);
  }

  // Append entry to Log.md
  const logPath = path.join(vaultDir, "Log.md");
  const logLine = `\n- **${new Date().toISOString()}** — Librarian processed ${processedInbox.length} Inbox drop(s) into ${createdSummaries.length} Wiki Summary note(s).\n`;
  fs.appendFileSync(logPath, logLine, "utf8");

  return { processedInbox, createdSummaries };
}

export async function runResearchPipeline(options: {
  mode: "fetch_only" | "process_inbox" | "run_pipeline";
  budget?: number;
  maxPerSource?: number;
}): Promise<{ report: ResearchRunReport; status: ResearchStatusData }> {
  const started = stamp();
  const cfg = loadSourcesConfig();
  const state = loadState();
  const { vaultDir, logsDir } = getPaths();

  const fetchedCounts: Record<string, number> = {};
  const dropped: string[] = [];
  const errors: string[] = [];

  if (options.mode === "fetch_only" || options.mode === "run_pipeline") {
    const budget = options.budget ?? cfg.budget_per_run ?? 12;
    const maxPerSrc = options.maxPerSource ?? cfg.max_per_source ?? 5;
    const sources = [...(cfg.sources || [])].sort(
      (a, b) => (a.priority ?? 99) - (b.priority ?? 99)
    );

    const fetchedBySource: Array<{ name: string; items: FeedItem[] }> = [];
    for (const src of sources) {
      try {
        const items = await fetchSourceItems(src, state);
        fetchedBySource.push({ name: src.name, items });
        fetchedCounts[src.name] = items.length;
      } catch (err) {
        fetchedCounts[src.name] = 0;
        errors.push(`${src.name}: ${(err as Error).message}`);
      }
    }

    const chosen: FeedItem[] = [];
    const newlySeen: string[] = [];
    for (const group of fetchedBySource) {
      let taken = 0;
      for (const it of group.items) {
        if (!it.id || state.seen[it.id]) continue;
        newlySeen.push(it.id);
        if (taken < maxPerSrc && chosen.length < budget) {
          chosen.push(it);
          taken++;
        }
      }
    }

    const inboxDir = path.join(vaultDir, "Inbox");
    fs.mkdirSync(inboxDir, { recursive: true });
    for (const it of chosen) {
      const base = sanitizeFilename(`${it.published} - ${it.source} - ${it.title}`);
      let target = path.join(inboxDir, `${base}.md`);
      if (fs.existsSync(target)) {
        const suffix = it.id.replace(/\W+/g, "").slice(-8) || String(dropped.length);
        target = path.join(inboxDir, `${base} (${suffix}).md`);
      }
      fs.writeFileSync(target, renderDropMarkdown(it), "utf8");
      dropped.push(path.relative(vaultDir, target).split(path.sep).join("/"));
    }

    const ts = nowDate();
    for (const id of newlySeen) {
      if (!state.seen[id]) state.seen[id] = ts;
    }
    saveState(state);
  }

  let processedInbox: string[] = [];
  let createdSummaries: string[] = [];
  let syncStats: VaultSyncStats | null = null;

  if (options.mode === "process_inbox" || options.mode === "run_pipeline") {
    const libRes = await processVaultInbox();
    processedInbox = libRes.processedInbox;
    createdSummaries = libRes.createdSummaries;
    syncStats = await syncVaultToDatabase(vaultDir, {
      enableAiEnrichment: false,
      exportRepoBrainPath: path.join(process.cwd(), ".cortex", "repo-brain.json"),
    });
  }

  const report: ResearchRunReport = {
    started,
    finished: stamp(),
    vault: vaultDir,
    fetched: fetchedCounts,
    dropped,
    processedInbox,
    createdSummaries,
    errors,
    syncStats,
  };

  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, `run-${started}.json`),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  return { report, status: getResearchStatus() };
}
