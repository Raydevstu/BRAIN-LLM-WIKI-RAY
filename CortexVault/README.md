# CortexVault - Phase 0 Starter Kit (human setup guide)

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
