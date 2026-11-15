"use client";

import React, { useState } from "react";
import { Plus, Sparkles, X } from "lucide-react";
import { DEFAULT_NODE_KIND_META } from "../services/layouts";
import type { GraphNodeKind } from "../types";
import { useGraph } from "../hooks/useGraph";

interface CreateNodeModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateNodeModal({ open, onClose }: CreateNodeModalProps) {
  const { createNode, digestNote, clusterHubs } = useGraph();

  const [mode, setMode] = useState<"structured" | "digest">("structured");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<GraphNodeKind>("note");
  const [cluster, setCluster] = useState("engineering");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [isKeyAnchor, setIsKeyAnchor] = useState(false);
  const [autoExtractLinks, setAutoExtractLinks] = useState(true);

  const [rawNote, setRawNote] = useState("");
  const [digesting, setDigesting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleRunDigest = async () => {
    if (!rawNote.trim()) return;
    setDigesting(true);
    setError(null);
    try {
      const digest = await digestNote(
        rawNote,
        Object.values(clusterHubs).map((c) => c.label)
      );
      setTitle(digest.title);
      setSummary(digest.summary);
      setContent(digest.fullMarkdown);
      setTagsText(digest.tags.join(", "));
      setMode("structured");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDigesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const tags = tagsText
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      const kindMeta = DEFAULT_NODE_KIND_META[kind];
      await createNode({
        title: title.trim(),
        kind,
        category: kindMeta?.label || "Note",
        cluster,
        summary: summary.trim() || title.trim(),
        content: content.trim() || summary.trim() || title.trim(),
        tags,
        isKeyAnchor,
        autoExtractLinks,
      });
      setTitle("");
      setSummary("");
      setContent("");
      setTagsText("");
      setRawNote("");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
      <div className="w-full max-w-xl rounded-xl border border-slate-700/80 bg-slate-950 text-slate-200 shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-4">
            <h2 className="text-base font-semibold text-white">Add Knowledge Node</h2>
            <div className="flex items-center gap-1 rounded-md border border-slate-800 bg-slate-900 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode("structured")}
                className={`rounded px-2.5 py-1 font-medium whitespace-nowrap shrink-0 transition-colors ${
                  mode === "structured"
                    ? "bg-slate-800 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Node Editor
              </button>
              <button
                type="button"
                onClick={() => setMode("digest")}
                className={`flex items-center gap-1 rounded px-2.5 py-1 font-medium whitespace-nowrap shrink-0 transition-colors ${
                  mode === "digest"
                    ? "bg-sky-500/20 text-sky-300"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                <Sparkles className="h-3 w-3" />
                <span>AI Digest</span>
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {error && (
          <div className="mx-5 mt-4 rounded-md border border-rose-500/40 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {mode === "digest" ? (
          <div className="space-y-4 p-5 text-xs">
            <p className="text-slate-400">
              Paste raw meeting notes, architecture specs, or research snippets. The engine
              structures the title, summary, tags, and cross-references before indexing into the graph.
            </p>
            <textarea
              rows={8}
              value={rawNote}
              onChange={(e) => setRawNote(e.target.value)}
              placeholder="# Distributed Caching Strategy&#10;Use Redis read-through cache backed by [[Postgres Schema v1]] with #latency-budget under 15ms..."
              className="w-full rounded-md border border-slate-700 bg-slate-900 p-3 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-700 px-3.5 py-2 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={digesting || !rawNote.trim()}
                onClick={handleRunDigest}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>{digesting ? "Digesting..." : "Structure & Preview"}</span>
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 p-5 text-xs">
            <label className="block text-[11px] font-medium text-slate-400">
              Title
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Reciprocal Rank Fusion"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-[11px] font-medium text-slate-400">
                Node Kind
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as GraphNodeKind)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  {Object.values(DEFAULT_NODE_KIND_META).map((m) => (
                    <option key={m.kind} value={m.kind}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-[11px] font-medium text-slate-400">
                Cluster
                <select
                  value={cluster}
                  onChange={(e) => setCluster(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-2.5 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
                >
                  {Object.values(clusterHubs).map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block text-[11px] font-medium text-slate-400">
              Summary
              <input
                type="text"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="Concise one-line overview..."
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </label>

            <label className="block text-[11px] font-medium text-slate-400">
              Markdown Content
              <textarea
                rows={4}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Detailed notes. Use [[Concept Name]] or #tags to seed automatic knowledge links..."
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </label>

            <label className="block text-[11px] font-medium text-slate-400">
              Tags (comma separated)
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="retrieval, pgvector, indexing"
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </label>

            <div className="flex flex-wrap items-center gap-5 pt-1">
              <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={autoExtractLinks}
                  onChange={(e) => setAutoExtractLinks(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-900 text-sky-500"
                />
                <span>Auto-extract entities, claims &amp; links</span>
              </label>

              <label className="flex cursor-pointer items-center gap-2 text-slate-300">
                <input
                  type="checkbox"
                  checked={isKeyAnchor}
                  onChange={(e) => setIsKeyAnchor(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-900 text-sky-500"
                />
                <span>Pin as key anchor</span>
              </label>
            </div>

            <footer className="flex justify-end gap-2 border-t border-slate-800 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-slate-700 px-4 py-2 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !title.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-4 py-2 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>{submitting ? "Indexing..." : "Create & Index"}</span>
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
