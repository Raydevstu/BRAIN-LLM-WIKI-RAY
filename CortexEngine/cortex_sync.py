#!/usr/bin/env python3
# CortexOS Sync Engine - Phase 1, slice 1
# Vault markdown -> nodes/edges/chunks -> MemoryStore (JSON) or Postgres + pgvector.
# Deps: pyyaml optional (pure-stdlib YAML frontmatter fallback included); psycopg[binary] (only for --store pg).
# Verify install: python3 cortex_sync.py --self-test

import os, re, sys, json, time, math, hashlib, logging, argparse
from pathlib import Path
from datetime import datetime, timezone
import urllib.request

try:
    import yaml  # type: ignore
except ImportError:
    yaml = None

LOG = logging.getLogger("cortex_sync")
FM = "-" * 3
FENCE = chr(96) * 3
DIM = 1536
INDEX_DIRS = ("Wiki", "Doctrine", "Armory", "Raw")   # Inbox/system zones are not knowledge yet
LINK_RE = re.compile(r"\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]")
FENCE_RE = re.compile(re.escape(FENCE) + r".*?" + re.escape(FENCE), re.S)
H1_RE = re.compile(r"^#\s+(.+)$", re.M)

SCHEMA = '''
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS meta (key text PRIMARY KEY, value text);
CREATE TABLE IF NOT EXISTS nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  path text UNIQUE NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}',
  body text NOT NULL DEFAULT '',
  redirect boolean NOT NULL DEFAULT false,
  updated date,
  hash text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now(),
  search tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' ||
                coalesce(props->>'aliases', '') || ' ' || coalesce(body, ''))
  ) STORED
);
CREATE INDEX IF NOT EXISTS nodes_search_idx ON nodes USING gin (search);
CREATE INDEX IF NOT EXISTS nodes_type_idx ON nodes (type);
CREATE TABLE IF NOT EXISTS edges (
  src uuid REFERENCES nodes(id) ON DELETE CASCADE,
  dst uuid REFERENCES nodes(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'REFERENCES',
  context text NOT NULL DEFAULT '',
  PRIMARY KEY (src, dst, kind)
);
CREATE TABLE IF NOT EXISTS chunks (
  id bigserial PRIMARY KEY,
  node_id uuid REFERENCES nodes(id) ON DELETE CASCADE,
  ord int NOT NULL,
  text text NOT NULL,
  hash text NOT NULL,
  embedding vector(1536),
  UNIQUE (node_id, ord)
);
CREATE INDEX IF NOT EXISTS chunks_vec_idx ON chunks USING hnsw (embedding vector_cosine_ops);
'''

# ---------------------------------------------------------------- parsing

def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]

def _fallback_parse_yaml_val(v):
    v = v.strip()
    if not v:
        return ""
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        return v[1:-1]
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        if not inner:
            return []
        return [str(_fallback_parse_yaml_val(item)).strip() for item in inner.split(",") if str(_fallback_parse_yaml_val(item)).strip()]
    return v

def _fallback_yaml_load(block):
    props = {}
    for line in block.splitlines():
        cleaned = re.sub(r"\s+#.*$", "", line).strip()
        if not cleaned or ":" not in cleaned:
            continue
        k, v = cleaned.split(":", 1)
        props[k.strip()] = _fallback_parse_yaml_val(v)
    return props

def split_frontmatter(text):
    if text.startswith(FM + "\n"):
        end = text.find("\n" + FM, 4)
        if end != -1:
            block = text[4:end]
            try:
                props = (yaml.safe_load(block) if yaml is not None else _fallback_yaml_load(block)) or {}
                if not isinstance(props, dict):
                    props = {}
            except Exception:
                props = {"parse_error": True}
            return props, text[end + len(FM) + 1:].lstrip("\n")
    return {}, text

def norm_name(s):
    return re.sub(r"\s+", " ", str(s).strip()).lower()

def infer_type(rel, props):
    if props.get("type"):
        return str(props["type"])
    parts = Path(rel).parts
    if parts[0] == "Raw":
        return "raw"
    if parts[0] == "Doctrine":
        return "doctrine"
    if parts[0] == "Armory":
        return "idea"
    if len(parts) > 1:
        return {"Concepts": "concept", "Entities": "entity",
                "Summaries": "summary"}.get(parts[1], "note")
    return "note"

def edge_kind(st, dt):
    if st == "summary":
        return "MENTIONS"
    if st == "entity" and dt == "entity":
        return "RELATED_TO"
    return "REFERENCES"

def parse_vault(vault):
    vault = Path(vault)
    files = []
    for d in INDEX_DIRS:
        base = vault / d
        if base.exists():
            files.extend(sorted(base.rglob("*.md")))
    nodes, errors = {}, []
    for p in files:
        rel = p.relative_to(vault).as_posix()
        try:
            text = p.read_text(encoding="utf-8")
        except Exception as e:
            errors.append(f"{rel}: {e}")
            continue
        props, body = split_frontmatter(text)
        h1 = H1_RE.search(body)
        tags = [str(t).lower() for t in as_list(props.get("tags"))]
        nodes[rel] = {
            "path": rel,
            "title": h1.group(1).strip() if h1 else p.stem,
            "type": infer_type(rel, props),
            "props": props,
            "body": body,
            "links": [m.group(1).strip() for m in LINK_RE.finditer(FENCE_RE.sub("", text))],
            "redirect": "redirect" in tags,
            "updated": str(props.get("updated") or props.get("created") or
                           datetime.fromtimestamp(p.stat().st_mtime, timezone.utc).strftime("%Y-%m-%d")),
            "hash": sha(text),
        }
    by_name = {}
    for rel, n in nodes.items():
        by_name.setdefault(norm_name(Path(rel).stem), rel)
        for a in as_list(n["props"].get("aliases")):
            by_name.setdefault(norm_name(a), rel)

    def resolve(target, depth=0):
        rel = by_name.get(norm_name(target))
        if rel and nodes[rel]["redirect"] and depth < 5:
            m = LINK_RE.search(FENCE_RE.sub("", nodes[rel]["body"]))
            if m:
                return resolve(m.group(1).strip(), depth + 1)
        return rel

    edges, dangling = [], set()
    for rel, n in nodes.items():
        if n["redirect"]:
            continue
        seen = set()
        for t in n["links"]:
            dst = resolve(t)
            if not dst:
                dangling.add(t)
                continue
            if dst == rel or nodes[dst]["redirect"]:
                continue
            kind = edge_kind(n["type"], nodes[dst]["type"])
            if (dst, kind) in seen:
                continue
            seen.add((dst, kind))
            ctx = next((ln.strip()[:200] for ln in n["body"].splitlines()
                        if "[[" + t in ln), "")
            edges.append({"src": rel, "dst": dst, "kind": kind, "context": ctx})
    return nodes, edges, {"dangling": sorted(dangling), "errors": errors}

def chunk_body(title, body, target=900):
    paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    chunks, cur = [], ""
    for p in paras:
        if len(p) > target:
            if cur:
                chunks.append(cur)
                cur = ""
            chunks.extend(p[i:i + target] for i in range(0, len(p), target))
        elif len(cur) + len(p) + 2 > target:
            chunks.append(cur)
            cur = p
        else:
            cur = (cur + "\n\n" + p) if cur else p
    if cur:
        chunks.append(cur)
    if not chunks:
        chunks = [title]
    return [{"ord": i, "text": c, "hash": sha(c), "embed_input": title + "\n" + c}
            for i, c in enumerate(chunks)]

# ---------------------------------------------------------------- embedders

class HashEmbedder:
    # Deterministic feature hashing. Lexical, NOT semantic - zero-infra fallback.
    name, model, dim = "hash", "feature-hash-v1", DIM
    def embed(self, texts):
        out = []
        for t in texts:
            v = [0.0] * DIM
            toks = re.findall(r"[a-z0-9]+", t.lower())
            for g in toks + ["_".join(p) for p in zip(toks, toks[1:])]:
                idx = int.from_bytes(hashlib.blake2b(g.encode(), digest_size=8).digest(), "big") % DIM
                v[idx] += 1.0
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / n for x in v])
        return out

class OpenAIEmbedder:
    name, model, dim = "openai", "text-embedding-3-small", DIM
    def __init__(self, key=None):
        self.key = key or os.environ.get("OPENAI_API_KEY")
        if not self.key:
            raise SystemExit("OPENAI_API_KEY not set")
    def embed(self, texts):
        out = []
        for i in range(0, len(texts), 64):
            req = urllib.request.Request(
                "https://api.openai.com/v1/embeddings",
                data=json.dumps({"model": self.model, "input": texts[i:i + 64]}).encode(),
                headers={"Authorization": "Bearer " + self.key,
                         "Content-Type": "application/json"})
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=60) as r:
                        data = json.loads(r.read())
                    out.extend(d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"]))
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    time.sleep(2 * (attempt + 1))
        return out

def make_embedder(choice):
    if choice == "hash":
        return HashEmbedder()
    if choice == "openai":
        return OpenAIEmbedder()
    if os.environ.get("OPENAI_API_KEY"):
        return OpenAIEmbedder()
    LOG.warning("no OPENAI_API_KEY; using hash embedder (lexical, not semantic)")
    return HashEmbedder()

# ---------------------------------------------------------------- retrieval fusion

def recency_boost(updated):
    try:
        d = datetime.strptime(str(updated)[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        age = max(0.0, (datetime.now(timezone.utc) - d).days)
        return 1.0 + 0.25 * math.exp(-age / 30.0)
    except Exception:
        return 1.0

def hybrid_search(store, embedder, q, k=10, type_filter=None, hops=1):
    kw = store.keyword_search(q, 30)
    sem = store.vector_search(embedder.embed([q])[0], 30)
    scores, via, snips = {}, {}, {}
    for label, rows in (("keyword", kw), ("semantic", sem)):
        for rank, row in enumerate(rows, 1):          # reciprocal rank fusion, k=60
            p = row[0]
            scores[p] = scores.get(p, 0.0) + 1.0 / (60 + rank)
            via.setdefault(p, []).append(label)
    for row in sem:
        if len(row) > 2 and row[2]:
            snips[row[0]] = row[2]
    seeds = sorted(scores, key=scores.get, reverse=True)[:8]
    for p, hop, seed in store.neighborhood(seeds, hops):
        if p in scores:
            continue
        scores[p] = scores.get(seed, 0.0) * (0.5 ** hop) * 0.6
        via[p] = ["graph"]
    nodes = store.get_nodes(list(scores))
    out = []
    for p, s in scores.items():
        n = nodes.get(p)
        if not n or n["redirect"]:
            continue
        if type_filter and n["type"] != type_filter:
            continue
        out.append({"path": p, "title": n["title"], "type": n["type"],
                    "score": round(s * recency_boost(n["updated"]), 6),
                    "via": via.get(p, []), "updated": n["updated"],
                    "snippet": snips.get(p) or (n.get("body") or "")[:240]})
    out.sort(key=lambda r: -r["score"])
    return out[:k]

# ---------------------------------------------------------------- stores

class StoreBase:
    def neighborhood(self, seeds, hops):
        seeds = [s for s in seeds if s]
        visited = set(seeds)
        frontier = {s: s for s in seeds}
        out = []
        for hop in range(1, hops + 1):
            adj = self.adjacent(list(frontier))
            nxt = {}
            for node, seed in frontier.items():
                for nb in adj.get(node, ()):
                    if nb in visited:
                        continue
                    visited.add(nb)
                    out.append((nb, hop, seed))
                    nxt[nb] = seed
            frontier = nxt
            if not frontier:
                break
        return out
    def save(self):
        pass
    def close(self):
        pass

class MemoryStore(StoreBase):
    # JSON-file store: zero-infrastructure mode, and the self-test target.
    def __init__(self, path):
        self.path = Path(path)
        self.data = {"nodes": {}, "edges": [], "chunks": {}, "meta": {}}
        self._mtime = 0
        if self.path.exists():
            self.reload()
    def reload(self):
        self.data = json.loads(self.path.read_text(encoding="utf-8"))
        self._mtime = self.path.stat().st_mtime
    def maybe_reload(self):
        try:
            if self.path.stat().st_mtime != self._mtime:
                self.reload()
        except FileNotFoundError:
            pass
    def save(self):
        self.path.write_text(json.dumps(self.data, default=str), encoding="utf-8")
        self._mtime = self.path.stat().st_mtime
    def init(self):
        pass
    def meta(self):
        return self.data["meta"]
    def set_meta(self, m):
        self.data["meta"].update(m)
    def hashes(self):
        return {p: n["hash"] for p, n in self.data["nodes"].items()}
    def ids(self):
        return {p: p for p in self.data["nodes"]}
    def upsert_node(self, n):
        self.data["nodes"][n["path"]] = {k: n[k] for k in
            ("path", "title", "type", "props", "body", "redirect", "updated", "hash")}
    def delete_nodes(self, paths):
        ps = set(paths)
        for p in ps:
            self.data["nodes"].pop(p, None)
            self.data["chunks"].pop(p, None)
        self.data["edges"] = [e for e in self.data["edges"]
                              if e["src"] not in ps and e["dst"] not in ps]
    def set_edges(self, src, edges, ids):
        self.data["edges"] = [e for e in self.data["edges"] if e["src"] != src] + edges
    def get_chunks(self, path):
        return self.data["chunks"].get(path, [])
    def set_chunks(self, path, chunks):
        self.data["chunks"][path] = chunks
    def keyword_search(self, q, limit):
        toks = set(re.findall(r"[a-z0-9]+", q.lower()))
        if not toks:
            return []
        scored = []
        for p, n in self.data["nodes"].items():
            if n["redirect"]:
                continue
            aliases = " ".join(str(a) for a in as_list(n["props"].get("aliases")))
            text = (n["title"] + " " + aliases + " " + n["body"]).lower()
            hits = sum(text.count(t) for t in toks)
            if hits:
                scored.append((p, float(hits)))
        scored.sort(key=lambda r: -r[1])
        return scored[:limit]
    def vector_search(self, qv, limit):
        best = {}
        for p, chunks in self.data["chunks"].items():
            n = self.data["nodes"].get(p)
            if not n or n["redirect"]:
                continue
            for c in chunks:
                v = c.get("vec")
                if not v:
                    continue
                s = sum(a * b for a, b in zip(qv, v))
                if s <= 0:
                    continue
                if p not in best or s > best[p][0]:
                    best[p] = (s, c["text"][:240])
        rows = [(p, s, sn) for p, (s, sn) in best.items()]
        rows.sort(key=lambda r: -r[1])
        return rows[:limit]
    def adjacent(self, paths):
        ps = set(paths)
        out = {p: set() for p in paths}
        for e in self.data["edges"]:
            a, b = e["src"], e["dst"]
            if a in ps and not self.data["nodes"].get(b, {}).get("redirect"):
                out[a].add(b)
            if b in ps and not self.data["nodes"].get(a, {}).get("redirect"):
                out[b].add(a)
        return {p: sorted(v) for p, v in out.items()}
    def get_nodes(self, paths):
        return {p: self.data["nodes"][p] for p in paths if p in self.data["nodes"]}
    def graph(self, paths):
        ps = set(paths)
        return [e for e in self.data["edges"] if e["src"] in ps and e["dst"] in ps
                and not self.data["nodes"].get(e["src"], {}).get("redirect")
                and not self.data["nodes"].get(e["dst"], {}).get("redirect")]
    def graph_for(self, path):
        return [e for e in self.data["edges"] if e["src"] == path or e["dst"] == path]
    def stats(self):
        types = {}
        for n in self.data["nodes"].values():
            types[n["type"]] = types.get(n["type"], 0) + 1
        return {"nodes": len(self.data["nodes"]), "edges": len(self.data["edges"]),
                "chunks": sum(len(c) for c in self.data["chunks"].values()),
                "types": types, "meta": self.data["meta"]}

class PgStore(StoreBase):
    # Production store: Postgres 14+ with pgvector. pip install "psycopg[binary]"
    def __init__(self, url):
        try:
            import psycopg
        except ImportError:
            raise SystemExit('psycopg missing: pip install "psycopg[binary]"')
        self.conn = psycopg.connect(url, autocommit=True)
    def init(self):
        self.conn.execute(SCHEMA)
    def meta(self):
        return dict(self.conn.execute("SELECT key, value FROM meta").fetchall())
    def set_meta(self, m):
        for k, v in m.items():
            self.conn.execute("INSERT INTO meta(key, value) VALUES(%s, %s) "
                              "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", (k, str(v)))
    def hashes(self):
        return dict(self.conn.execute("SELECT path, hash FROM nodes").fetchall())
    def ids(self):
        return dict(self.conn.execute("SELECT path, id::text FROM nodes").fetchall())
    def upsert_node(self, n):
        upd = str(n["updated"])[:10]
        try:
            datetime.strptime(upd, "%Y-%m-%d")
        except Exception:
            upd = None
        self.conn.execute(
            "INSERT INTO nodes(path, type, title, props, body, redirect, updated, hash) "
            "VALUES(%s, %s, %s, %s::jsonb, %s, %s, %s::date, %s) "
            "ON CONFLICT (path) DO UPDATE SET type = EXCLUDED.type, title = EXCLUDED.title, "
            "props = EXCLUDED.props, body = EXCLUDED.body, redirect = EXCLUDED.redirect, "
            "updated = EXCLUDED.updated, hash = EXCLUDED.hash, synced_at = now()",
            (n["path"], n["type"], n["title"], json.dumps(n["props"], default=str),
             n["body"], n["redirect"], upd, n["hash"]))
    def delete_nodes(self, paths):
        if paths:
            self.conn.execute("DELETE FROM nodes WHERE path = ANY(%s)", (list(paths),))
    def set_edges(self, src, edges, ids):
        sid = ids.get(src)
        if not sid:
            return
        self.conn.execute("DELETE FROM edges WHERE src = %s::uuid", (sid,))
        for e in edges:
            did = ids.get(e["dst"])
            if did:
                self.conn.execute("INSERT INTO edges(src, dst, kind, context) "
                                  "VALUES(%s::uuid, %s::uuid, %s, %s) "
                                  "ON CONFLICT DO NOTHING",
                                  (sid, did, e["kind"], e.get("context", "")))
    def get_chunks(self, path):
        rows = self.conn.execute(
            "SELECT c.ord, c.text, c.hash, c.embedding::text FROM chunks c "
            "JOIN nodes n ON n.id = c.node_id WHERE n.path = %s ORDER BY c.ord", (path,)).fetchall()
        return [{"ord": r[0], "text": r[1], "hash": r[2],
                 "vec": json.loads(r[3]) if r[3] else None} for r in rows]
    def set_chunks(self, path, chunks):
        nid = self.ids().get(path)
        if not nid:
            return
        self.conn.execute("DELETE FROM chunks WHERE node_id = %s::uuid", (nid,))
        for c in chunks:
            self.conn.execute("INSERT INTO chunks(node_id, ord, text, hash, embedding) "
                              "VALUES(%s::uuid, %s, %s, %s, %s::vector)",
                              (nid, c["ord"], c["text"], c["hash"],
                               json.dumps(c["vec"]) if c.get("vec") is not None else None))
    def keyword_search(self, q, limit):
        if not q.strip():
            return []
        rows = self.conn.execute(
            "SELECT path, ts_rank(search, q) AS score FROM nodes, "
            "websearch_to_tsquery('english', %s) AS q "
            "WHERE search @@ q AND NOT redirect ORDER BY score DESC LIMIT %s", (q, limit)).fetchall()
        return [(r[0], float(r[1])) for r in rows]
    def vector_search(self, qv, limit):
        vec = json.dumps(qv)
        rows = self.conn.execute(
            "SELECT n.path, 1 - (c.embedding <=> %s::vector) AS score, left(c.text, 240) "
            "FROM chunks c JOIN nodes n ON n.id = c.node_id "
            "WHERE NOT n.redirect AND c.embedding IS NOT NULL "
            "ORDER BY c.embedding <=> %s::vector LIMIT %s", (vec, vec, limit * 3)).fetchall()
        best = {}
        for p, s, sn in rows:
            if float(s) <= 0:
                continue
            if p not in best or s > best[p][0]:
                best[p] = (float(s), sn)
        out = [(p, s, sn) for p, (s, sn) in best.items()]
        out.sort(key=lambda r: -r[1])
        return out[:limit]
    def adjacent(self, paths):
        if not paths:
            return {}
        rows = self.conn.execute(
            "SELECT s.path, d.path FROM edges e "
            "JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst "
            "WHERE (s.path = ANY(%s) OR d.path = ANY(%s)) "
            "AND NOT s.redirect AND NOT d.redirect", (paths, paths)).fetchall()
        out = {p: set() for p in paths}
        for a, b in rows:
            if a in out:
                out[a].add(b)
            if b in out:
                out[b].add(a)
        return {p: sorted(v) for p, v in out.items()}
    def get_nodes(self, paths):
        if not paths:
            return {}
        rows = self.conn.execute(
            "SELECT path, title, type, props, redirect, updated::text, body "
            "FROM nodes WHERE path = ANY(%s)", (list(paths),)).fetchall()
        return {r[0]: {"path": r[0], "title": r[1], "type": r[2], "props": r[3],
                       "redirect": r[4], "updated": r[5], "body": r[6]} for r in rows}
    def graph(self, paths):
        if not paths:
            return []
        rows = self.conn.execute(
            "SELECT s.path, d.path, e.kind FROM edges e "
            "JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst "
            "WHERE s.path = ANY(%s) AND d.path = ANY(%s) "
            "AND NOT s.redirect AND NOT d.redirect", (list(paths), list(paths))).fetchall()
        return [{"src": r[0], "dst": r[1], "kind": r[2]} for r in rows]
    def graph_for(self, path):
        rows = self.conn.execute(
            "SELECT s.path, d.path, e.kind FROM edges e "
            "JOIN nodes s ON s.id = e.src JOIN nodes d ON d.id = e.dst "
            "WHERE s.path = %s OR d.path = %s", (path, path)).fetchall()
        return [{"src": r[0], "dst": r[1], "kind": r[2]} for r in rows]
    def stats(self):
        n = self.conn.execute("SELECT count(*) FROM nodes").fetchone()[0]
        e = self.conn.execute("SELECT count(*) FROM edges").fetchone()[0]
        c = self.conn.execute("SELECT count(*) FROM chunks").fetchone()[0]
        types = dict(self.conn.execute("SELECT type, count(*) FROM nodes GROUP BY type").fetchall())
        return {"nodes": n, "edges": e, "chunks": c, "types": types, "meta": self.meta()}
    def close(self):
        self.conn.close()

def make_store(args):
    if args.store == "pg":
        url = args.db or os.environ.get("DATABASE_URL")
        if not url:
            raise SystemExit("--store pg needs --db or DATABASE_URL")
        return PgStore(url)
    return MemoryStore(args.state)

# ---------------------------------------------------------------- sync engine

def sync(vault, store, embedder, full=False, no_embed=False):
    t0 = time.time()
    nodes, edges, issues = parse_vault(vault)
    store.init()
    ident = {"embedder": embedder.name, "model": embedder.model, "dim": str(embedder.dim)}
    m = store.meta()
    if m.get("embedder") and any(m.get(k) != v for k, v in ident.items()) and not full:
        raise SystemExit(f"embedder changed ({m.get('embedder')} -> {embedder.name}); "
                         "run with --full to re-embed everything")
    store.set_meta(ident)
    old = store.hashes()
    changed = [p for p, n in nodes.items() if full or old.get(p) != n["hash"]]
    deleted = [p for p in old if p not in nodes]
    store.delete_nodes(deleted)
    for p in changed:
        store.upsert_node(nodes[p])
    ids = store.ids()
    by_src = {}
    for e in edges:
        by_src.setdefault(e["src"], []).append(e)
    for p in changed:
        store.set_edges(p, by_src.get(p, []), ids)
    emb_new = emb_reused = 0
    for p in changed:
        n = nodes[p]
        if n["redirect"]:
            store.set_chunks(p, [])
            continue
        new_chunks = chunk_body(n["title"], n["body"])
        old_chunks = {c["hash"]: c for c in store.get_chunks(p)}
        todo = []
        for c in new_chunks:
            oc = old_chunks.get(c["hash"])
            c["vec"] = oc.get("vec") if oc else None
            if c["vec"] is None:
                todo.append(c)
            else:
                emb_reused += 1
        if todo and not no_embed:
            for c, v in zip(todo, embedder.embed([c["embed_input"] for c in todo])):
                c["vec"] = v
            emb_new += len(todo)
        for c in new_chunks:
            c.pop("embed_input", None)
        store.set_chunks(p, new_chunks)
    store.set_meta({"last_sync": datetime.now(timezone.utc).isoformat()})
    store.save()
    return {"scanned": len(nodes), "upserted": len(changed), "deleted": len(deleted),
            "edges": len(edges), "embedded": emb_new, "reused": emb_reused,
            "dangling": issues["dangling"], "errors": issues["errors"],
            "seconds": round(time.time() - t0, 2)}

# ---------------------------------------------------------------- self-test

def self_test():
    import tempfile, threading, traceback
    from urllib.parse import urlencode
    passed = []
    def check(cond, label):
        if not cond:
            raise AssertionError(label)
        passed.append(label)
        print("PASS", label)
    try:
        tmp = Path(tempfile.mkdtemp())
        vault = tmp / "Vault"
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        def note(rel, fm_extra, body):
            p = vault / rel
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(FM + "\n" + fm_extra.format(d=today) + "\n" + FM + "\n" + body,
                         encoding="utf-8")
        note("Wiki/Concepts/Knowledge Graph.md",
             "type: concept\naliases: [KG]\ntags: [graph]\ncreated: {d}\nupdated: {d}",
             "# Knowledge Graph\n\nNodes and edges over knowledge. Links [[CortexOS]] and [[Second Brain]]. " + ("graph context " * 65) + "\n")
        note("Wiki/Concepts/AI Second Brain.md",
             "type: concept\naliases: [Second Brain, LLM Wiki]\ntags: [pkm]\ncreated: {d}\nupdated: {d}",
             "# AI Second Brain\n\nAn LLM-maintained wiki. Uses a [[Knowledge Graph]]. See [[Nonexistent Page]].\n")
        note("Wiki/Entities/CortexOS.md",
             "type: entity\nentity_kind: project\naliases: []\ntags: [project]\ncreated: {d}\nupdated: {d}",
             "# CortexOS\n\nKnowledge OS project. Built on [[Knowledge-Graph]] and [[Obsidian]].\n")
        note("Wiki/Entities/Obsidian.md",
             "type: entity\nentity_kind: product\naliases: []\ntags: [tool]\ncreated: {d}\nupdated: {d}",
             "# Obsidian\n\nMarkdown editor for the [[AI Second Brain]].\n")
        note("Wiki/Concepts/Knowledge-Graph.md",
             "type: concept\naliases: []\ntags: [redirect]\ncreated: {d}\nupdated: {d}",
             "# Knowledge-Graph\n\n> Redirect -> [[Knowledge Graph]]\n")
        note("Wiki/Summaries/2026-11-16 - Test Video.md",
             "type: summary\naliases: []\ntags: [video]\ncreated: {d}\nupdated: {d}\nsources: [\"[[Knowledge Graph]]\"]",
             "# Test Video\n\nCovers [[Knowledge Graph]] and [[CortexOS]].\n")
        note("Doctrine/Test Doctrine.md",
             "type: doctrine\naliases: []\ntags: []\ncreated: {d}\nupdated: {d}",
             "# Test Doctrine\n\nBased on [[2026-11-16 - Test Video]].\n")
        note("Armory/Test Idea.md",
             "type: idea\naliases: []\ntags: []\ncreated: {d}\nupdated: {d}\nstatus: idea\nhook: test",
             "# Test Idea\n\nEvidence: [[2026-11-16 - Test Video]].\n")
        (vault / "Raw").mkdir(parents=True, exist_ok=True)
        (vault / "Raw/source.md").write_text("Verbatim source text about graphs.", encoding="utf-8")
        (vault / "Templates").mkdir(parents=True, exist_ok=True)
        (vault / "Templates/T.md").write_text("skip me", encoding="utf-8")
        (vault / "Inbox").mkdir(parents=True, exist_ok=True)
        (vault / "Inbox/pending.md").write_text("skip me too", encoding="utf-8")

        nodes, edges, issues = parse_vault(vault)
        check(len(nodes) == 9, "parser: 9 nodes (system zones + Inbox excluded)")
        check(nodes["Raw/source.md"]["type"] == "raw", "parser: Raw inferred without frontmatter")
        check(nodes["Wiki/Concepts/Knowledge-Graph.md"]["redirect"], "parser: redirect stub flagged")
        kg = "Wiki/Concepts/Knowledge Graph.md"
        co = "Wiki/Entities/CortexOS.md"
        check(any(e["src"] == co and e["dst"] == kg for e in edges),
              "parser: link via redirect stub retargeted to canonical")
        check(any(e["src"] == kg and e["dst"] == "Wiki/Concepts/AI Second Brain.md" for e in edges),
              "parser: alias link [[Second Brain]] resolved")
        check(any(e["kind"] == "MENTIONS" for e in edges), "parser: summary edges typed MENTIONS")
        check("Nonexistent Page" in issues["dangling"], "parser: dangling link reported, no crash")

        ch = chunk_body("T", "para one\n\n" + "x" * 2000 + "\n\npara two")
        check(all(len(c["text"]) <= 900 for c in ch), "chunker: respects size cap")
        check(chunk_body("T", "a\n\nb") == chunk_body("T", "a\n\nb"), "chunker: deterministic")

        emb = HashEmbedder()
        v1, v2 = emb.embed(["knowledge graph nodes edges"])[0], emb.embed(["knowledge graph nodes edges"])[0]
        check(v1 == v2 and len(v1) == DIM, "embedder: deterministic, dim 1536")
        check(abs(math.sqrt(sum(x * x for x in v1)) - 1.0) < 1e-9, "embedder: L2 normalized")
        sim = lambda a, b: sum(x * y for x, y in zip(emb.embed([a])[0], emb.embed([b])[0]))
        check(sim("knowledge graph", "knowledge graph nodes edges") > sim("banana", "knowledge graph nodes edges"),
              "embedder: lexical similarity sanity")
        check(recency_boost(today) > recency_boost("2020-01-01"), "ranking: recency boost decays")

        store = MemoryStore(tmp / "store.json")
        r1 = sync(vault, store, emb)
        check(r1["upserted"] == 9 and r1["embedded"] > 0, "sync: first run indexes everything")
        r2 = sync(vault, store, emb)
        check(r2["upserted"] == 0 and r2["embedded"] == 0, "sync: unchanged vault is a no-op")
        p = vault / kg
        p.write_text(p.read_text(encoding="utf-8") + "\nA brand new paragraph about retrieval.\n", encoding="utf-8")
        r3 = sync(vault, store, emb)
        check(r3["upserted"] == 1 and r3["reused"] >= 1 and r3["embedded"] >= 1,
              "sync: hash-incremental upsert + chunk-level embedding reuse")
        (vault / "Armory/Test Idea.md").unlink()
        r4 = sync(vault, store, emb)
        check(r4["deleted"] == 1 and "Armory/Test Idea.md" not in store.data["nodes"],
              "sync: deleted file removed with its edges")

        res = hybrid_search(store, emb, "knowledge graph", k=5)
        check(res and res[0]["path"] == kg, "search: 'knowledge graph' ranks the concept first")
        check(all(not store.data["nodes"][r["path"]]["redirect"] for r in res),
              "search: redirect stubs never returned")
        check(any("graph" in r["via"] for r in hybrid_search(store, emb, "knowledge graph", k=10, hops=1)),
              "search: graph expansion contributes neighbors")
        ents = hybrid_search(store, emb, "obsidian", k=10, type_filter="entity")
        check(ents and all(r["type"] == "entity" for r in ents), "search: type filter works")

        try:
            from cortex_api import make_handler
            from http.server import ThreadingHTTPServer
            srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(store, emb))
            port = srv.server_address[1]
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            get = lambda path: json.loads(urllib.request.urlopen(
                f"http://127.0.0.1:{port}{path}", timeout=10).read())
            check(get("/health")["ok"], "api: /health")
            check(get("/search?" + urlencode({"q": "knowledge graph"}))["results"][0]["path"] == kg,
                  "api: /search live")
            check(get("/node?" + urlencode({"path": kg}))["node"]["title"] == "Knowledge Graph",
                  "api: /node live")
            g = get("/graph?" + urlencode({"path": kg, "hops": 2}))
            check(g["nodes"] and g["edges"] and "id" in g["nodes"][0], "api: /graph XYFlow shape")
            srv.shutdown()
        except ImportError:
            print("SKIP api checks (cortex_api.py not next to cortex_sync.py)")
        print(f"\nSELF-TEST: {len(passed)} checks passed")
        return 0
    except Exception:
        traceback.print_exc()
        print("\nSELF-TEST FAILED")
        return 1

# ---------------------------------------------------------------- CLI

def main(argv=None):
    ap = argparse.ArgumentParser(description="CortexOS sync engine: vault -> graph store")
    ap.add_argument("--vault", default="../CortexVault")
    ap.add_argument("--store", choices=["memory", "pg"], default="memory")
    ap.add_argument("--db", default=None, help="Postgres URL (or DATABASE_URL env)")
    ap.add_argument("--state", default="cortex_store.json", help="MemoryStore JSON path")
    ap.add_argument("--embedder", choices=["auto", "openai", "hash"], default="auto")
    ap.add_argument("--full", action="store_true", help="force re-upsert + re-embed everything")
    ap.add_argument("--no-embed", action="store_true", help="graph only, skip embedding calls")
    ap.add_argument("--watch", type=int, default=0, metavar="SECONDS", help="poll loop")
    ap.add_argument("--stats", action="store_true")
    ap.add_argument("--init-db", action="store_true", help="apply schema (pg only)")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.self_test:
        return self_test()
    store = make_store(args)
    try:
        if args.init_db:
            store.init()
            print("schema applied")
            return 0
        if args.stats:
            print(json.dumps(store.stats(), indent=1, default=str))
            return 0
        embedder = make_embedder(args.embedder)
        while True:
            report = sync(args.vault, store, embedder, full=args.full, no_embed=args.no_embed)
            print(json.dumps(report, indent=1))
            if not args.watch:
                return 0
            args.full = False
            time.sleep(args.watch)
    except KeyboardInterrupt:
        return 0
    finally:
        store.close()

if __name__ == "__main__":
    sys.exit(main())
