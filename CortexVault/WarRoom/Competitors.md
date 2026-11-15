# Competitors

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
