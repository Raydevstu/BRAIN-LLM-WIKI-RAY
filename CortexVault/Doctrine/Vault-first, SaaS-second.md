---
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
