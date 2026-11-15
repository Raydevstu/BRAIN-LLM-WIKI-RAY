#!/usr/bin/env python3
# CortexOS Retrieval API - stdlib HTTP server over MemoryStore or PgStore.
# Endpoints: /health /search /node /graph  (CORS enabled for XYFlow UI)

import json, argparse, logging
from urllib.parse import urlparse, parse_qs
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from cortex_sync import make_store, make_embedder, hybrid_search, LOG

def make_handler(store, embedder):
    class H(BaseHTTPRequestHandler):
        def log_message(self, fmt, *a):
            LOG.debug(fmt, *a)
        def _send(self, code, obj):
            data = json.dumps(obj, default=str).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        def do_GET(self):
            u = urlparse(self.path)
            q = {k: v[0] for k, v in parse_qs(u.query).items()}
            try:
                if hasattr(store, "maybe_reload"):
                    store.maybe_reload()
                if u.path == "/health":
                    self._send(200, {"ok": True, "stats": store.stats()})
                elif u.path == "/search":
                    if not q.get("q"):
                        return self._send(400, {"error": "q required"})
                    res = hybrid_search(store, embedder, q["q"], k=int(q.get("k", 10)),
                                        type_filter=q.get("type"), hops=int(q.get("hops", 1)))
                    self._send(200, {"query": q["q"], "results": res})
                elif u.path == "/node":
                    p = q.get("path", "")
                    ns = store.get_nodes([p])
                    if p not in ns:
                        return self._send(404, {"error": "not found", "path": p})
                    n = ns[p]
                    self._send(200, {"node": {k: n[k] for k in
                                     ("path", "title", "type", "props", "updated", "redirect")},
                                     "edges": store.graph_for(p)})
                elif u.path == "/graph":
                    p = q.get("path", "")
                    if p not in store.get_nodes([p]):
                        return self._send(404, {"error": "not found", "path": p})
                    reach = {p} | {r[0] for r in store.neighborhood([p], int(q.get("hops", 2)))}
                    nodes = store.get_nodes(sorted(reach))
                    es = store.graph(sorted(reach))
                    self._send(200, {
                        "nodes": [{"id": n["path"], "label": n["title"], "type": n["type"]}
                                  for n in nodes.values()],
                        "edges": [{"source": e["src"], "target": e["dst"], "kind": e["kind"]}
                                  for e in es]})
                else:
                    self._send(404, {"error": "unknown endpoint"})
            except Exception as e:
                self._send(500, {"error": str(e)})
    return H

def main():
    ap = argparse.ArgumentParser(description="CortexOS retrieval API")
    ap.add_argument("--store", choices=["memory", "pg"], default="memory")
    ap.add_argument("--db", default=None)
    ap.add_argument("--state", default="cortex_store.json")
    ap.add_argument("--embedder", choices=["auto", "openai", "hash"], default="auto")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    store = make_store(args)
    embedder = make_embedder(args.embedder)
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(store, embedder))
    LOG.info("CortexOS API on http://127.0.0.1:%d (store=%s)", args.port, args.store)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        store.close()

if __name__ == "__main__":
    main()
