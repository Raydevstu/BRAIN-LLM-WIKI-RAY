# Home

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
