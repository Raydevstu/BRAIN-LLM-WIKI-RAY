#!/usr/bin/env python3
# CortexOS Research Agent - Phase 0.5 slice
# RSS / arXiv / YouTube competitor uploads -> Inbox/ -> headless Librarian -> sync hook
# Stdlib only. Python 3.9+. Tested: parsers, dedupe, budgets, locking, git, dry-run.

import os, re, sys, json, time, html, shutil, logging, argparse
import urllib.request, urllib.parse, urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import subprocess

FM = "-" * 3
UA = "CortexOS-ResearchAgent/0.1 (personal knowledge vault)"
ATOM = "{http://www.w3.org/2005/Atom}"
YTNS = "{http://www.youtube.com/xml/schemas/2015}"
MRSS = "{http://search.yahoo.com/mrss/}"
ARXIV_API = "http://export.arxiv.org/api/query"
YT_FEED = "https://www.youtube.com/feeds/videos.xml?channel_id="
LOG = logging.getLogger("research_agent")
SEEN_CAP = 8000

def now_date():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def stamp():
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")

DEFAULT_CONFIG = {
    "vault": "../CortexVault",
    "budget_per_run": 12,
    "max_per_source": 5,
    "polite_delay_s": 1.0,
    "http_timeout_s": 30,
    "librarian": {
        "enabled": True,
        "command": ["claude", "-p",
                    "Run the daily routine per CLAUDE.md: process Inbox fully, "
                    "reconcile the board, fix broken links, append the Log entry.",
                    "--permission-mode", "acceptEdits"],
        "timeout_s": 900
    },
    "git": {"auto_commit": True},
    "sync": {"command": None},
    "notify": {"webhook_url": None, "style": "slack"},
    "sources": [
        {"name": "Wes Roth", "kind": "youtube", "handle": "@WesRoth",
         "priority": 1, "tags": ["competitor-coverage", "ai-news"]},
        {"name": "arXiv AI/CL/LG", "kind": "arxiv",
         "categories": ["cs.AI", "cs.CL", "cs.LG"], "fetch": 40, "priority": 2},
        {"name": "Google AI Blog", "kind": "rss",
         "url": "https://blog.google/technology/ai/rss/", "priority": 3},
        {"name": "Hugging Face Blog", "kind": "rss",
         "url": "https://huggingface.co/blog/feed.xml", "priority": 3}
    ]
}

# ---------------------------------------------------------------- http + parsing

class FetchError(Exception):
    pass

def http_get(url, timeout=30, retries=2):
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:
            last = e
            if attempt < retries:
                time.sleep(2 * (attempt + 1))
    raise FetchError(f"{url} -> {last}")

def strip_html(s):
    if not s:
        return ""
    s = re.sub(r"<[^>]+>", " ", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()

def clip(s, n):
    s = s or ""
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"

def parse_date(s):
    if not s:
        return now_date()
    try:
        return parsedate_to_datetime(s).strftime("%Y-%m-%d")
    except Exception:
        pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).strftime("%Y-%m-%d")
    except Exception:
        return now_date()

def parse_feed(data):
    # Handles RSS 2.0 and Atom (incl. YouTube uploads + arXiv API responses).
    root = ET.fromstring(data)
    items = []
    if root.tag == ATOM + "feed":
        for e in root.findall(ATOM + "entry"):
            def t(tag):
                el = e.find(ATOM + tag)
                return (el.text or "").strip() if el is not None and el.text else ""
            link = ""
            for l in e.findall(ATOM + "link"):
                if l.get("rel", "alternate") == "alternate":
                    link = l.get("href", "")
                    break
            if not link:
                l = e.find(ATOM + "link")
                link = l.get("href", "") if l is not None else ""
            vid = e.find(YTNS + "videoId")
            desc = e.find(".//" + MRSS + "description")
            summary = t("summary") or t("content")
            if not summary and desc is not None and desc.text:
                summary = desc.text
            authors = [a.findtext(ATOM + "name", "").strip()
                       for a in e.findall(ATOM + "author")]
            cats = [c.get("term", "") for c in e.findall(ATOM + "category")]
            items.append({
                "id": t("id") or link,
                "title": strip_html(t("title")),
                "url": link,
                "published": parse_date(t("published") or t("updated")),
                "summary": clip(strip_html(summary), 1500),
                "authors": [a for a in authors if a],
                "tags": [c for c in cats if c],
                "video_id": vid.text.strip() if vid is not None and vid.text else ""
            })
    else:
        for it in root.iter("item"):
            def t(tag):
                el = it.find(tag)
                return (el.text or "").strip() if el is not None and el.text else ""
            link = t("link")
            guid = t("guid") or link
            items.append({
                "id": guid,
                "title": strip_html(t("title")),
                "url": link,
                "published": parse_date(t("pubDate") or t("date")),
                "summary": clip(strip_html(t("description") or t("encoded")), 1500),
                "authors": [t("creator")] if t("creator") else [],
                "tags": [],
                "video_id": ""
            })
    return items

# ---------------------------------------------------------------- state + sources

def load_state(home):
    p = home / "state.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"seen": {}, "channels": {}}

def save_state(home, state):
    seen = state.get("seen", {})
    if len(seen) > SEEN_CAP:
        keep = sorted(seen.items(), key=lambda kv: kv[1], reverse=True)[:SEEN_CAP]
        state["seen"] = dict(keep)
    (home / "state.json").write_text(json.dumps(state, indent=1), encoding="utf-8")

def resolve_channel(src, state, timeout):
    cid = src.get("channel_id", "")
    if cid:
        return cid
    handle = src.get("handle", "")
    if not handle:
        raise FetchError(f"youtube source '{src.get('name')}' needs channel_id or handle")
    if handle in state.get("channels", {}):
        return state["channels"][handle]
    page = http_get("https://www.youtube.com/" + handle, timeout=timeout).decode("utf-8", "replace")
    for pat in (r'"channelId":"(UC[0-9A-Za-z_-]{22})"',
                r'"externalId":"(UC[0-9A-Za-z_-]{22})"',
                r'youtube\.com/channel/(UC[0-9A-Za-z_-]{22})'):
        m = re.search(pat, page)
        if m:
            state.setdefault("channels", {})[handle] = m.group(1)
            return m.group(1)
    raise FetchError(f"could not resolve channel_id for {handle}; set channel_id in config")

def fetch_source(src, state, cfg):
    kind = src["kind"]
    timeout = cfg.get("http_timeout_s", 30)
    if kind == "arxiv":
        cats = src.get("categories", ["cs.AI", "cs.CL", "cs.LG"])
        q = " OR ".join("cat:" + c for c in cats)
        url = ARXIV_API + "?" + urllib.parse.urlencode(
            {"search_query": q, "sortBy": "submittedDate", "sortOrder": "descending",
             "max_results": src.get("fetch", 40)})
        raw = parse_feed(http_get(url, timeout=timeout))
    elif kind == "youtube":
        cid = resolve_channel(src, state, timeout)
        raw = parse_feed(http_get(YT_FEED + cid, timeout=timeout))
        for it in raw:
            if it["video_id"]:
                it["url"] = "https://www.youtube.com/watch?v=" + it["video_id"]
                it["id"] = "yt:" + it["video_id"]
    elif kind == "rss":
        raw = parse_feed(http_get(src["url"], timeout=timeout))
    else:
        raise FetchError(f"unknown source kind: {kind}")
    inc = [re.compile(p, re.I) for p in src.get("include", [])]
    exc = [re.compile(p, re.I) for p in src.get("exclude", [])]
    out = []
    for it in raw:
        text = (it["title"] or "") + " " + (it["summary"] or "")
        if inc and not any(p.search(text) for p in inc):
            continue
        if any(p.search(text) for p in exc):
            continue
        it["source"] = src["name"]
        it["kind"] = kind
        it["suggested_tags"] = src.get("tags", []) + (it["tags"] if kind == "arxiv" else [])
        out.append(it)
    return out

def select_items(fetched_by_source, state, budget, per_source):
    seen = state.get("seen", {})
    chosen, newly = [], []
    for name, items in fetched_by_source:
        taken = 0
        for it in items:
            if not it["id"] or it["id"] in seen:
                continue
            newly.append(it["id"])
            if taken < per_source and len(chosen) < budget:
                chosen.append(it)
                taken += 1
    return chosen, newly

# ---------------------------------------------------------------- inbox drops

def sanitize_filename(s, limit=110):
    s = re.sub(r'[:/\\|?*<>"#^\[\]]', " ", s or "")
    s = re.sub(r"\s+", " ", s).strip().rstrip(".")
    return clip(s, limit)

def render_drop(it):
    tags = ", ".join(dict.fromkeys(it.get("suggested_tags", [])))
    authors = ", ".join(it.get("authors", [])[:12])
    lines = [FM,
             "source_url: " + it["url"],
             "source_kind: " + it["kind"],
             "source_name: " + json.dumps(it["source"]),
             "published: " + it["published"],
             "retrieved: " + now_date(),
             "suggested_tags: [" + tags + "]"]
    if it["kind"] == "youtube":
        lines.append("coverage_hint: competitor-coverage")
    if authors:
        lines.append("authors: " + json.dumps(authors))
    lines += [FM, "# " + it["title"], "",
              "- Source: " + it["source"] + " (" + it["kind"] + ")",
              "- URL: " + it["url"],
              "- Published: " + it["published"]]
    if authors:
        lines.append("- Authors: " + authors)
    if it.get("summary"):
        lines += ["", "## Abstract / description", it["summary"]]
    lines += ["", "## Librarian instructions",
              "Process per CLAUDE.md section 6 (Raw copy, Summary, ripple, opportunity check).",
              "If coverage_hint is competitor-coverage, also apply section 8 (creator rules).", ""]
    return "\n".join(lines)

def write_drops(vault, items):
    inbox = vault / "Inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    paths = []
    for it in items:
        base = sanitize_filename(f"{it['published']} - {it['source']} - {it['title']}")
        p = inbox / (base + ".md")
        if p.exists():
            suffix = re.sub(r"\W+", "", it["id"])[-8:] or str(len(paths))
            p = inbox / (base + " (" + suffix + ").md")
        p.write_text(render_drop(it), encoding="utf-8")
        paths.append(p)
    return paths

# ---------------------------------------------------------------- locking

class Lock:
    def __init__(self, home, stale_s=3600):
        self.path = home / "agent.lock"
        self.stale_s = stale_s
    def __enter__(self):
        if self.path.exists():
            age = time.time() - self.path.stat().st_mtime
            if age < self.stale_s:
                raise RuntimeError(f"another run is active (lock age {int(age)}s): {self.path}")
            LOG.warning("breaking stale lock (%ds old)", int(age))
            self.path.unlink()
        fd = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        os.write(fd, str(os.getpid()).encode())
        os.close(fd)
        return self
    def __exit__(self, *exc):
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

# ---------------------------------------------------------------- git + commands

def git_available():
    return shutil.which("git") is not None

def git_run(vault, *args):
    return subprocess.run(["git", "-C", str(vault), *args],
                          capture_output=True, text=True)

def git_commit(vault, msg, enabled):
    if not enabled or not git_available() or not (vault / ".git").exists():
        return False
    if not git_run(vault, "status", "--porcelain").stdout.strip():
        return False
    git_run(vault, "add", "-A")
    r = git_run(vault, "commit", "-m", msg)
    return r.returncode == 0

def run_cmd_logged(cmd, cwd, log_path, timeout):
    with open(log_path, "w", encoding="utf-8") as f:
        try:
            r = subprocess.run(cmd, cwd=str(cwd), stdout=f, stderr=subprocess.STDOUT,
                               timeout=timeout)
            return r.returncode
        except subprocess.TimeoutExpired:
            f.write(f"\n[research_agent] TIMEOUT after {timeout}s\n")
            return -1
        except FileNotFoundError:
            f.write(f"\n[research_agent] command not found: {cmd[0]}\n")
            return -2

def notify(cfg, text):
    n = cfg.get("notify", {})
    url = n.get("webhook_url")
    if not url:
        return
    key = "content" if n.get("style") == "discord" else "text"
    try:
        req = urllib.request.Request(url, data=json.dumps({key: text}).encode(),
                                     headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as e:
        LOG.warning("notify failed: %s", e)

# ---------------------------------------------------------------- orchestration

def orchestrate(cfg, home, args):
    vault = (home / cfg["vault"]).resolve()
    if not (vault / "CLAUDE.md").exists():
        raise SystemExit(f"vault not found or missing CLAUDE.md: {vault}")
    logs = home / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    state = load_state(home)
    report = {"started": stamp(), "vault": str(vault), "fetched": {},
              "dropped": [], "errors": [], "librarian": None, "sync": None}

    if not args.librarian_only:
        sources = sorted(cfg["sources"], key=lambda s: s.get("priority", 99))
        fetched = []
        for src in sources:
            try:
                items = fetch_source(src, state, cfg)
                fetched.append((src["name"], items))
                report["fetched"][src["name"]] = len(items)
                LOG.info("fetched %d items from %s", len(items), src["name"])
            except Exception as e:
                report["errors"].append(f"{src['name']}: {e}")
                LOG.warning("source failed: %s: %s", src["name"], e)
            time.sleep(cfg.get("polite_delay_s", 1.0))
        budget = args.budget if args.budget is not None else cfg.get("budget_per_run", 12)
        per_src = args.max_per_source if args.max_per_source is not None else cfg.get("max_per_source", 5)
        chosen, newly = select_items(fetched, state, budget, per_src)
        LOG.info("selected %d new items (%d unseen total)", len(chosen), len(newly))
        if args.dry_run:
            for it in chosen:
                LOG.info("[dry-run] would drop: %s | %s", it["source"], it["title"])
            report["dry_run"] = True
            report["would_drop"] = [it["title"] for it in chosen]
        else:
            paths = write_drops(vault, chosen)
            report["dropped"] = [str(p.relative_to(vault)) for p in paths]
            ts = now_date()
            for iid in newly:
                state["seen"].setdefault(iid, ts)
            save_state(home, state)
            if git_commit(vault, f"research agent: {len(paths)} inbox drops",
                          cfg.get("git", {}).get("auto_commit", True)):
                LOG.info("git: committed inbox drops")

    if not args.fetch_only and not args.dry_run and cfg.get("librarian", {}).get("enabled", True):
        lib = cfg["librarian"]
        log_path = logs / f"librarian-{stamp()}.log"
        rc = run_cmd_logged(lib["command"], vault, log_path, lib.get("timeout_s", 900))
        report["librarian"] = {"returncode": rc, "log": str(log_path)}
        LOG.info("librarian exit=%s log=%s", rc, log_path)
        if rc == 0:
            if git_commit(vault, "librarian: processed inbox",
                          cfg.get("git", {}).get("auto_commit", True)):
                LOG.info("git: committed librarian changes")
            sync_cmd = cfg.get("sync", {}).get("command")
            if sync_cmd:
                slog = logs / f"sync-{stamp()}.log"
                src_rc = run_cmd_logged(sync_cmd, home, slog, 600)
                report["sync"] = {"returncode": src_rc, "log": str(slog)}
                LOG.info("sync hook exit=%s", src_rc)
        else:
            report["errors"].append(f"librarian exited {rc}; drops remain in Inbox for next run")

    report["finished"] = stamp()
    rp = logs / f"run-{report['started']}.json"
    rp.write_text(json.dumps(report, indent=1), encoding="utf-8")
    summary = (f"CortexOS Research Agent: {len(report['dropped'])} drops, "
               f"{len(report['errors'])} errors, librarian={report['librarian']}")
    notify(cfg, summary)
    LOG.info("report: %s", rp)
    return report

def main(argv=None):
    ap = argparse.ArgumentParser(description="CortexOS Research Agent: feeds -> Inbox -> Librarian -> sync hook")
    ap.add_argument("--config", default="sources.json")
    ap.add_argument("--init", action="store_true", help="write example sources.json next to you")
    ap.add_argument("--fetch-only", action="store_true", help="fetch + drop, skip Librarian")
    ap.add_argument("--librarian-only", action="store_true", help="skip fetching, just run Librarian + sync")
    ap.add_argument("--dry-run", action="store_true", help="show what would be dropped; no writes")
    ap.add_argument("--budget", type=int, default=None)
    ap.add_argument("--max-per-source", type=int, default=None)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args(argv)

    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    cfg_path = Path(args.config).resolve()
    if args.init:
        if cfg_path.exists():
            raise SystemExit(f"refusing to overwrite {cfg_path}")
        cfg_path.write_text(json.dumps(DEFAULT_CONFIG, indent=2), encoding="utf-8")
        print(f"wrote {cfg_path} - edit vault path and sources, then run without --init")
        return 0
    if not cfg_path.exists():
        raise SystemExit(f"config not found: {cfg_path} (run with --init first)")
    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    home = cfg_path.parent
    with Lock(home):
        orchestrate(cfg, home, args)
    return 0

if __name__ == "__main__":
    sys.exit(main())
