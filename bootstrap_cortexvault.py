#!/usr/bin/env python3
# CortexOS Phase 0 - Second Brain Starter Kit bootstrap (Complete 31-file edition)
# Usage: python3 bootstrap_cortexvault.py [target_dir] [--force] [--git]

import argparse
import json
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

FILES: dict[str, str] = {}

FILES["CLAUDE.md"] = '''# CLAUDE.md - CortexOS Librarian Rulebook (Phase 0)

You are the Librarian of this vault. Shaan captures; you ingest, file, link,
summarize, and maintain. This file is the contract. Follow it exactly.

## 1. Prime directives
1. Never invent facts. Every claim in Wiki/ traces to a Raw/ file or a cited URL.
2. Never delete or rewrite anything in Raw/. It is the immutable source layer.
3. Extend existing pages before creating new ones. Duplicates are graph poison.
4. If unsure, write `UNVERIFIED:` inline and append the open question to Log.md.
   Never guess.
5. Keep the structure flat. Maximum depth is Wiki/<subfolder>. Never create
   deeper folders.
6. Small, surgical edits. One run = one coherent diff the human can review.

## 2. Vault map
| Path | Purpose | Your access |
|---|---|---|
| Inbox/ | Unprocessed captures (URLs, notes, files) | Read, process, then remove items |
| Raw/ | Verbatim source copies | Create only. Never edit or delete |
| Wiki/Concepts/ | One page per idea or topic | Create / update |
| Wiki/Entities/ | People, companies, channels, repos, projects, products | Create / update |
| Wiki/Summaries/ | One page per source | Create / update |
| Doctrine/ | Observation -> Analysis -> Recommendation | Create; supersede with dated updates |
| Armory/ | Video ideas and future projects | Create / update |
| WarRoom/ | Analytics CSVs, competitor drops, collection SOPs | Read; annotate findings in Log.md |
| Index.md | Map of every Concept and Entity | Maintain |
| Log.md | Append-only journal + weekly briefs | Append only |
| Templates/, Boards/, Home.md, README.md, .obsidian/, .git/ | System zones | Never ingest or rewrite. Boards: read-only (see section 9) |

## 3. Note schema
YAML frontmatter on every Wiki/, Doctrine/, and Armory/ note:

```yaml
---
type: concept | entity | summary | doctrine | idea
entity_kind: person | company | channel | repo | project | product   # entities only
aliases: []          # alternate names, handles, abbreviations - used for dedupe
tags: []             # lowercase, e.g. ai-news, competitor, llm, youtube
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: []          # wikilinks to Summary pages and/or external URLs
status: idea | researching | scripted | published   # Armory ideas only
hook: ""             # Armory ideas only: one-line video hook
---
```

- Summaries may add `url:` and `published:` fields.
- Dates are the real current date. Bump `updated` on every edit.
- When creating a note, copy the matching file in Templates/ and replace
  {{title}} and {{date}} with real values.

## 4. Naming
- Entities: `Canonical Name.md`. Concepts: `Concept Name.md`.
- Summaries and Raw: `YYYY-MM-DD - Title.md` (date first).
- Ideas: verb-first, e.g. `I Built X.md`.
- No `:` `/` `\\` in filenames.

## 5. Linking rules
- First mention of any entity or concept in a note -> [[wikilink]].
- Every Wiki note has at least 2 outbound links and appears in Index.md.
- Summaries link to everything they touch; every touched page gets a dated
  bullet and a back-link under `## Related` (the ripple).
- Search titles AND aliases before creating any page.
- Skip pages tagged `redirect` in all maintenance and queries.

## 6. Ingestion workflow (run for every item in Inbox/)
1. Read or fetch the item.
2. Save a verbatim copy to Raw/ (`YYYY-MM-DD - Title.md`). For URLs, save the
   extracted text with the source URL and fetch date at the top. For files,
   copy the original as-is.
3. Create Wiki/Summaries/ page: TL;DR (max 5 bullets), Key claims, Notable
   quotes, What changed vs. what we knew.
4. Ripple: create or update every Concept and Entity touched. Add dated
   bullets, back-links, bump `updated`.
5. Opportunity check: if the item implies an action or opportunity, draft a
   Doctrine/ page or an Armory/ idea (see section 8).
6. Update Index.md. Append a Log.md entry. Remove the item from Inbox/.
7. If fetching fails: leave the item in Inbox/, log the failure, move on.

## 7. Dedupe and merge protocol
- Before creating an entity, search case- and punctuation-insensitively across
  titles and aliases ("OpenAI" = "Open AI" = "@OpenAI").
- If a duplicate exists: merge its content into the canonical page, add the
  other name to `aliases`, update all wikilinks vault-wide to the canonical
  name, and replace the duplicate file's body with
  `> Redirect -> [[Canonical Name]]` and `tags: [redirect]`.
- Never delete Wiki files; stubs preserve old links.

## 8. Creator rules (this vault serves an AI YouTube channel)
- Competitor channels are entities with `entity_kind: channel` and tag
  `competitor`. Log their notable videos as Summaries tagged
  `competitor-coverage`, linking the channel and every topic covered.
- Shaan's own published videos are Summaries tagged `our-video`.
- Trend-gap check: a Concept with 3+ distinct sources from the last 14 days,
  no Armory idea linking to it, and no `our-video` covering it -> propose an
  Armory idea.
- Every Armory idea must contain: Hook, Angle, Evidence (links), Competing
  coverage, Next action. Set `status: idea` and fill the `hook` frontmatter.

## 9. Board reconciliation (daily)
- Read Boards/Creator Pipeline.md. Columns are Idea / Researching / Scripted /
  Published. For each card linking an Armory idea, set that idea's frontmatter
  `status` to its column name, lowercased.
- Never edit the board file itself - it belongs to the human.
- If an idea is missing from the board, note it in Log.md so Shaan adds a card.

## 10. WarRoom analytics
- CSV drops are named `YYYY-MM-DD_youtube-studio.csv`,
  `YYYY-MM-DD_channel-stats.csv`, etc.
- During the weekly brief, read the latest drop, compare with the previous
  one, and report deltas. Never fabricate numbers not present in the files.

## 11. Maintenance
Daily:
- Process Inbox/ fully. Reconcile the board (section 9). Fix broken links you
  encounter. Append to Log.md:
  `## YYYY-MM-DD - Daily` with bullets: ingested / created / updated / questions.

Weekly (append to Log.md):
- `## YYYY-MM-DD - Weekly Brief` with sections:
  1. Top 3 trends (with evidence links)
  2. Coverage gaps (trend-gap check, section 8)
  3. 3 recommended videos (one-line hooks)
  4. Doctrine to revisit (unchanged 30+ days)
  5. Vault health (duplicates merged, orphans fixed, broken links)

Doctrine updates: append `### Update YYYY-MM-DD` - keep the history, never
silently rewrite a recommendation.

## 12. Safety and git
- Do not run git commands unless explicitly asked; the human or the Obsidian
  Git plugin handles commits.
- Never touch .obsidian/ or any system zone.
- End every run with a 5-line summary of what changed.
'''

FILES["README.md"] = '''# CortexVault - Phase 0 Starter Kit (human setup guide)

## 1. Open the vault
Open this folder in Obsidian ("Open folder as vault").

## 2. Install plugins
Settings -> Community plugins -> turn off Restricted mode -> Browse:
- Dataview
- Kanban
- Obsidian Git
Install + enable each. Enable Core "Templates" plugin (pre-pointed at Templates/).

## 3. Sync with CortexOS Graph Engine
Run `npx tsx packages/graph-engine/services/vault-sync.ts ./CortexVault` to project
all Markdown notes, YAML frontmatter, and `[[wikilinks]]` into PGlite/Postgres.
'''

FILES["Index.md"] = '''# Index

Map of the vault. Maintained by the Librarian: every Concept and Entity must
appear here exactly once.

## Knowledge Systems
- [[AI Second Brain]] - AI-maintained personal knowledge base (LLM Wiki)
- [[Knowledge Graph]] - nodes + edges over your knowledge
- [[OODA Loop]] - Observe, Orient, Decide, Act cycle

## Projects
- [[CortexOS]] - Shaan's Knowledge Operating System (Phase 0 live in this vault)

## People and Channels
- [[Andrej Karpathy]] - credited with the LLM Wiki concept
- [[Wes Roth]] - AI news channel; competitor reference

## Tools
- [[Obsidian]] - local-first markdown editor; the vault's IDE

## Where things live
- Sources: Wiki/Summaries/ - Conclusions: Doctrine/ - Ideas: Armory/
- Dashboard: [[Home]] - Journal: [[Log]]
'''

FILES["Log.md"] = '''# Log

Append-only journal. Daily entries + weekly briefs per CLAUDE.md section 11.

## 2026-11-15 - Daily
- Bootstrap: vault created via starter kit; seed notes written.
- Seeded from: Wes Roth, "Claude Built the Ultimate Second Brain".
- Next: drop 15-20 known items into Inbox/ (own videos, competitors, papers).
- Open question: which 5 competitor channels should be tracked first?
'''

FILES["Home.md"] = '''# Home

Creator intelligence dashboard. Rendered by Dataview - do not hand-edit data
here; edit the underlying notes.

## Inbox queue
```dataview
LIST FROM "Inbox" SORT file.name ASC
```

## Creator pipeline
```dataview
TABLE status AS "Stage", hook AS "Hook", updated AS "Updated"
FROM "Armory"
WHERE type = "idea"
SORT updated DESC
```

## Trend gaps (topics heating up with no video idea yet)
```dataviewjs
const cutoff = dv.date("today").minus({ days: 14 });
const ideas = dv.pages('"Armory"').where(p => p.type === "idea");
const covered = new Set();
for (const i of ideas) for (const l of i.file.outlinks) covered.add(l.path);
const rows = [];
for (const c of dv.pages('"Wiki/Concepts"')) {
  if (!c.updated || c.updated < cutoff) continue;
  if (covered.has(c.file.path)) continue;
  const recent = dv.pages('"Wiki/Summaries"').where(s =>
    s.created && s.created >= cutoff &&
    s.file.outlinks.some(l => l.path === c.file.path)).length;
  if (recent >= 3) rows.push([c.file.link, recent, c.updated.toFormat("yyyy-MM-dd")]);
}
if (rows.length) dv.table(["Topic", "Recent sources", "Updated"], rows);
else dv.paragraph("No gaps with 3+ recent sources right now. Keep feeding the Inbox.");
```

## Recent intelligence
```dataview
TABLE created AS "Logged", url AS "Source"
FROM "Wiki/Summaries"
SORT created DESC
LIMIT 10
```

## Doctrine to revisit (30+ days stale)
```dataview
LIST FROM "Doctrine"
WHERE type = "doctrine" AND updated <= date(today) - dur(30 days)
```

## Orphans (Wiki pages with no inbound links - fix during weekly maintenance)
```dataview
LIST FROM "Wiki"
WHERE length(file.inlinks) = 0
```
'''

FILES[".gitignore"] = '''.obsidian/workspace.json
.obsidian/workspace-mobile.json
.trash/
.DS_Store
agent.log
'''

FILES["Templates/Concept.md"] = '''---
type: concept
aliases: []
tags: []
created: {{date}}
updated: {{date}}
sources: []
---
# {{title}}

## Definition
One paragraph, plain language.

## Why it matters
Why this concept earns a page in this vault.

## Key developments
- {{date}}: ...

## Related
- Link at least two related Concepts/Entities here.
'''

FILES["Templates/Entity.md"] = '''---
type: entity
entity_kind: person
aliases: []
tags: []
created: {{date}}
updated: {{date}}
sources: []
---
# {{title}}

## Profile
- Kind: person | company | channel | repo | project | product
- Links / handles:

## Notes
What this entity is and why it matters to Shaan.

## Timeline
- {{date}}: ...

## Related
- Link at least two related pages here.
'''

FILES["Templates/Summary.md"] = '''---
type: summary
aliases: []
tags: []
created: {{date}}
updated: {{date}}
url: ""
published: ""
sources: []
---
# {{title}}

## TL;DR
- Max 5 bullets.

## Key claims
- Claim (with timestamp or section anchor).

## Notable quotes
> ...

## What changed vs. what we knew
- ...

## Ripple
Pages created or updated because of this source:
- ...

## Related
- Link every Concept and Entity this source touches.
'''

FILES["Templates/Doctrine.md"] = '''---
type: doctrine
aliases: []
tags: []
created: {{date}}
updated: {{date}}
sources: []
---
# {{title}}

## Observation
What the evidence shows (link sources).

## Analysis
Why it is true / what it implies.

## Recommendation
The concrete action to take.

## What would change my mind
Falsifiers - evidence that should reverse this doctrine.

## Update log
- {{date}}: created.
'''

FILES["Templates/Idea.md"] = '''---
type: idea
aliases: []
tags: []
created: {{date}}
updated: {{date}}
sources: []
status: idea
hook: ""
---
# {{title}}

## Hook
One line. Why would a viewer click?

## Angle
The unique take - what only this channel can say.

## Evidence
- Links to Summaries / Concepts backing this idea.

## Competing coverage
- Which channels covered this, when, and the gap they left.

## Next action
The single next physical step (research, outline, script).
'''

FILES["Boards/Creator Pipeline.md"] = '''---
kanban-plugin: basic
---

## Idea
- [ ] [[I Built an AI Second Brain That Runs My Channel]]

## Researching

## Scripted

## Published

%% kanban:settings
```
{"kanban-plugin":"basic","new-note-folder":"Armory","new-note-template":"Templates/Idea.md"}
```
%%
'''

FILES["Wiki/Concepts/AI Second Brain.md"] = '''---
type: concept
aliases: [Second Brain, LLM Wiki]
tags: [pkm, llm]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# AI Second Brain

## Definition
A personal knowledge base maintained by an LLM acting as librarian: it
ingests sources, writes summaries, and cross-links concepts and entities so
knowledge compounds instead of piling up. Concept credited to
[[Andrej Karpathy]] as the "LLM Wiki"; demonstrated by [[Wes Roth]] with
[[Obsidian]] + Claude Code.

## Why it matters
It is the zero-infrastructure version of [[CortexOS]]: markdown files are the
database, wikilinks are the edges, and CLAUDE.md is the agent policy.

## Key developments
- 2026-11-15: Seeded from [[2026-11-15 - Claude Built the Ultimate Second Brain]].

## Related
- [[Knowledge Graph]]
- [[OODA Loop]]
'''

FILES["Wiki/Concepts/Knowledge Graph.md"] = '''---
type: concept
aliases: [KG, personal knowledge graph]
tags: [graph, pkm]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# Knowledge Graph

## Definition
Knowledge stored as nodes (concepts, entities, sources) and edges (typed or
wiki-style links), so retrieval can traverse relationships instead of just
matching text.

## Why it matters
In this vault every wikilink is an edge curated at write time by the
Librarian - which is exactly the graph [[CortexOS]] Phase 1 projects into
Postgres.

## Key developments
- 2026-11-15: Vault graph seeded; visualizable in [[Obsidian]] and CortexOS XYFlow.

## Related
- [[AI Second Brain]]
- [[CortexOS]]
'''

FILES["Wiki/Concepts/OODA Loop.md"] = '''---
type: concept
aliases: [OODA]
tags: [strategy]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# OODA Loop

## Definition
Observe -> Orient -> Decide -> Act, repeated continuously. Originally a
combat-strategy model; applied here to knowledge and content operations.

## Why it matters
It is the operating cycle of the [[AI Second Brain]]: Observe = Inbox/Raw,
Orient = Wiki ripple, Decide = Doctrine + Armory, Act = publish and measure
in WarRoom. [[CortexOS]] automates each stage in later phases.

## Key developments
- 2026-11-15: Framing adopted from [[Wes Roth]]'s video summary.

## Related
- [[AI Second Brain]]
- [[CortexOS]]
'''

FILES["Wiki/Entities/CortexOS.md"] = '''---
type: entity
entity_kind: project
aliases: [SecondBrain-OS, BRAIN-LLM-WIKI-RAY]
tags: [project, active]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# CortexOS

## Profile
- Kind: project (Shaan's)
- Goal: Knowledge Operating System - capture, connect, understand, act.

## Notes
Phase 0 is this vault: [[Obsidian]] + Claude Code + CLAUDE.md, implementing
the [[AI Second Brain]] pattern. Phase 1 projects the markdown
[[Knowledge Graph]] into PGlite/Postgres + pgvector with hybrid retrieval, an
XYFlow graph UI, a Research Agent cron, and a creator dashboard. Strategy
recorded in [[Vault-first, SaaS-second]].

## Timeline
- 2026-11-15: Phase 0 vault + Phase 1 TypeScript engine linked.

## Related
- [[AI Second Brain]]
- [[Knowledge Graph]]
'''

FILES["Wiki/Entities/Wes Roth.md"] = '''---
type: entity
entity_kind: channel
aliases: [WesRoth, "@WesRoth"]
tags: [ai-news, competitor]
created: 2026-11-15
updated: 2026-11-15
url: https://www.youtube.com/@WesRoth
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# Wes Roth

## Profile
- Kind: YouTube channel (AI news and commentary)
- Handle: @WesRoth

## Notes
Reference competitor for the AI niche. Demonstrated an [[AI Second Brain]]
built on [[Obsidian]] + Claude Code, including creator-analytics use cases -
directly adjacent to [[CortexOS]]'s creator angle.

## Timeline
- 2026-11-15: Logged video "Claude Built the Ultimate Second Brain"
  (see [[2026-11-15 - Claude Built the Ultimate Second Brain]]).

## Related
- [[AI Second Brain]]
- [[Andrej Karpathy]]
'''

FILES["Wiki/Entities/Andrej Karpathy.md"] = '''---
type: entity
entity_kind: person
aliases: [Karpathy, "@karpathy"]
tags: [ai-research]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# Andrej Karpathy

## Profile
- Kind: person (AI researcher, educator)
- Handle: @karpathy

## Notes
Credited by [[Wes Roth]] with the "LLM Wiki" concept: an LLM-maintained
personal wiki where raw sources are distilled into interlinked Markdown concept
and entity notes—the seed architecture behind [[AI Second Brain]] and [[CortexOS]].

## Timeline
- 2026-11-15: Referenced in [[2026-11-15 - Claude Built the Ultimate Second Brain]].

## Related
- [[AI Second Brain]]
- [[Wes Roth]]
'''

FILES["Wiki/Entities/Obsidian.md"] = '''---
type: entity
entity_kind: product
aliases: [Obsidian.md]
tags: [pkm, tool]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# Obsidian

## Profile
- Kind: product (local-first Markdown knowledge base)
- Website: https://obsidian.md

## Notes
Serves as the human IDE for Phase 0 of [[CortexOS]]. Plain-text Markdown +
YAML frontmatter + `[[wikilinks]]` allows both humans and the Claude Code
Librarian to read and write the [[Knowledge Graph]] with zero impedance mismatch.

## Timeline
- 2026-11-15: Configured with Dataview, Kanban, and Obsidian Git for Phase 0.

## Related
- [[AI Second Brain]]
- [[CortexOS]]
'''

FILES["Wiki/Summaries/2026-11-15 - Claude Built the Ultimate Second Brain.md"] = '''---
type: summary
aliases: [Wes Roth Second Brain Video]
tags: [pkm, llm, competitor-coverage]
created: 2026-11-15
updated: 2026-11-15
url: "https://www.youtube.com/@WesRoth"
published: "2026-11-15"
sources: []
---
# 2026-11-15 - Claude Built the Ultimate Second Brain

## TL;DR
- [[Wes Roth]] demonstrates an [[AI Second Brain]] using [[Obsidian]] + Claude Code + a `CLAUDE.md` rulebook.
- Inspired by [[Andrej Karpathy]]'s "LLM Wiki" workflow: immutable `Raw/` drops distilled into `Wiki/` pages.
- Flat folder hierarchy prevents LLM navigation failure.
- Implements an [[OODA Loop]] (Observe in Inbox, Orient in Wiki, Decide in Doctrine, Act in Armory/WarRoom).
- Validates the [[Vault-first, SaaS-second]] build order for [[CortexOS]].

## Key claims
- Deep folder nesting degrades agent tool-use accuracy; flat folders + `Index.md` scale much better.
- Curating edges at write-time (`[[wikilinks]]`) beats hallucinated post-hoc RAG chunking.

## Notable quotes
> "The markdown vault is your database; CLAUDE.md is your agent policy."

## What changed vs. what we knew
- Confirmed that Layers 1-4 and Layer 7 of [[CortexOS]] run with zero infrastructure in Phase 0, feeding Phase 1 Postgres via deterministic projection.

## Ripple
- Created: [[AI Second Brain]], [[Knowledge Graph]], [[OODA Loop]], [[CortexOS]], [[Wes Roth]], [[Andrej Karpathy]], [[Obsidian]], [[Vault-first, SaaS-second]], [[I Built an AI Second Brain That Runs My Channel]].

## Related
- [[Wes Roth]]
- [[Andrej Karpathy]]
- [[AI Second Brain]]
- [[Knowledge Graph]]
- [[OODA Loop]]
- [[CortexOS]]
- [[Obsidian]]
'''

FILES["Doctrine/Vault-first, SaaS-second.md"] = '''---
type: doctrine
aliases: [Vault First Strategy]
tags: [strategy, architecture]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
---
# Vault-first, SaaS-second

## Observation
Building a 10-layer multi-tenant SaaS before curating a real dataset burns months
on plumbing while leaving the graph empty. Meanwhile, [[Obsidian]] + Claude Code
delivers Layers 1-4 and 7 in a single weekend ([[2026-11-15 - Claude Built the Ultimate Second Brain]]).

## Analysis
When the Librarian agent curates YAML frontmatter, `aliases`, and `[[wikilinks]]`
at write time inside Markdown, the Phase 1 [[CortexOS]] Postgres + pgvector engine
doesn't have to pay an LLM to re-extract entities on every sync—it parses the
curated Markdown deterministically and uses LLMs only for proposed enrichments.

## Recommendation
1. Keep `CortexVault/` as the canonical source of truth.
2. Project `CortexVault/` into `packages/graph-engine` via `vault-sync.ts`.
3. Build Creator Dashboard widgets as pure SQL/graph queries over the projected vault.

## What would change my mind
- If multi-user real-time collaborative editing becomes required before single-player
  creator workflows are validated.
- If vault file count exceeds 50,000 notes and filesystem watcher latency exceeds 2 seconds.

## Update log
- 2026-11-15: Created and ratified as core build order for [[CortexOS]].
'''

FILES["Armory/I Built an AI Second Brain That Runs My Channel.md"] = '''---
type: idea
aliases: [Second Brain Channel Video]
tags: [youtube, cortexos, pkm]
created: 2026-11-15
updated: 2026-11-15
sources: ["[[2026-11-15 - Claude Built the Ultimate Second Brain]]"]
status: idea
hook: "Everyone builds AI wrappers—I built a local-first Knowledge OS that runs my entire YouTube research pipeline."
---
# I Built an AI Second Brain That Runs My Channel

## Hook
Everyone builds AI wrappers—I built a local-first Knowledge OS that runs my entire YouTube research pipeline.

## Angle
Show the two-stage architecture live: Phase 0 ([[Obsidian]] + `CLAUDE.md` rulebook ingesting competitor videos and papers) projecting in real time into Phase 1 ([[CortexOS]] Next.js + XYFlow + hybrid RRF search + trend-gap detector).

## Evidence
- [[2026-11-15 - Claude Built the Ultimate Second Brain]]
- [[Vault-first, SaaS-second]]
- [[AI Second Brain]]

## Competing coverage
- [[Wes Roth]] covered the pure Obsidian + Claude Code setup, but stopped short of projecting the vault into a custom Postgres + pgvector hybrid graph engine with live trend-gap SQL widgets.

## Next action
Record a 60-second screen capture of `vault-sync.ts` projecting `CortexVault/` into the XYFlow canvas.
'''

FILES["WarRoom/Competitors.md"] = '''# Competitors

Auto-updating table of tracked competitor channels (`entity_kind: channel` and tag `competitor`).

```dataview
TABLE url AS "Channel URL", updated AS "Last Activity", length(file.inlinks) AS "Logged Videos"
FROM "Wiki/Entities"
WHERE type = "entity" AND entity_kind = "channel" AND contains(tags, "competitor")
SORT updated DESC
```

## Competitor Coverage Matrix
```dataview
TABLE WITHOUT ID file.link AS "Summary", published AS "Published", file.outlinks AS "Topics & Entities Covered"
FROM "Wiki/Summaries"
WHERE contains(tags, "competitor-coverage")
SORT created DESC
```
'''

FILES["Inbox/.gitkeep"] = ""
FILES["Raw/.gitkeep"] = ""

FILES[".obsidian/app.json"] = json.dumps(
    {"alwaysUpdateLinks": True, "newFileLocation": "folder", "newFileFolderPath": "Inbox"},
    indent=2,
)
FILES[".obsidian/appearance.json"] = json.dumps({"baseFontSize": 16}, indent=2)
FILES[".obsidian/core-plugins.json"] = json.dumps(
    [
        "file-explorer",
        "global-search",
        "switcher",
        "graph",
        "backlink",
        "canvas",
        "outgoing-link",
        "tag-pane",
        "page-preview",
        "templates",
        "command-palette",
        "editor-status",
        "bookmarks",
        "outline",
    ],
    indent=2,
)
FILES[".obsidian/templates.json"] = json.dumps(
    {"folder": "Templates", "dateFormat": "YYYY-MM-DD", "timeFormat": "HH:mm"},
    indent=2,
)
FILES[".obsidian/community-plugins.json"] = json.dumps(
    ["dataview", "obsidian-kanban", "obsidian-git"], indent=2
)
FILES[".obsidian/plugins/dataview/data.json"] = json.dumps(
    {
        "renderNullAs": "\\-",
        "taskCompletionTracking": True,
        "enableDataviewJs": True,
        "enableInlineDataview": True,
        "enableInlineDataviewJs": True,
    },
    indent=2,
)
FILES[".obsidian/plugins/obsidian-kanban/data.json"] = json.dumps(
    {"new-note-folder": "Armory", "new-note-template": "Templates/Idea.md"},
    indent=2,
)
FILES[".obsidian/plugins/obsidian-git/data.json"] = json.dumps(
    {
        "commitMessage": "vault backup: {{date}}",
        "autoCommitMessage": "vault auto-backup: {{date}}",
        "commitDateFormat": "YYYY-MM-DD HH:mm:ss",
        "autoSaveInterval": 30,
        "autoPushInterval": 0,
        "autoPullInterval": 0,
        "autoPullOnBoot": False,
        "disablePush": True,
    },
    indent=2,
)


def bootstrap(target_dir: Path, force: bool = False, init_git: bool = False) -> None:
    target_dir = target_dir.resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    written = 0
    skipped = 0

    for rel_path, content in FILES.items():
        dest = target_dir / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists() and not force:
            skipped += 1
            continue
        dest.write_text(content, encoding="utf-8")
        written += 1

    print(f"[CortexVault] Target: {target_dir}")
    print(f"[CortexVault] Files written: {written} | Skipped (already exist): {skipped}")

    if init_git and not (target_dir / ".git").exists():
        subprocess.run(["git", "init"], cwd=target_dir, check=False)
        subprocess.run(["git", "add", "."], cwd=target_dir, check=False)
        subprocess.run(
            ["git", "commit", "-m", "chore: bootstrap CortexVault Phase 0 starter kit"],
            cwd=target_dir,
            check=False,
        )
        print("[CortexVault] Initialized git repository and created initial commit.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap CortexVault Phase 0 Starter Kit")
    parser.add_argument("target_dir", nargs="?", default="./CortexVault", help="Path to vault folder")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    parser.add_argument("--git", action="store_true", help="Initialize git repo and commit")
    args = parser.parse_args()
    bootstrap(Path(args.target_dir), force=args.force, init_git=args.git)


if __name__ == "__main__":
    main()
