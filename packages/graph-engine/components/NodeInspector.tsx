"use client";

import React, { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  Edit3,
  Link2,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useGraph } from "../hooks/useGraph";
import type { GraphEdgeType, GraphNode, KnowledgeClaim } from "../types";

interface NodeInspectorProps {
  node: GraphNode | null;
  onClose: () => void;
}

function NodeInspectorBody({
  node,
  onClose,
}: {
  node: GraphNode;
  onClose: () => void;
}) {
  const {
    nodes,
    edges,
    setSelectedNodeId,
    updateNode,
    deleteNode,
    linkNodes,
    unlinkEdge,
    fetchNodeClaims,
    askNodeContext,
  } = useGraph();

  const [claims, setClaims] = useState<KnowledgeClaim[]>([]);
  const [question, setQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const [linkTargetId, setLinkTargetId] = useState("");
  const [linkType, setLinkType] = useState<GraphEdgeType>("relates_to");

  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(node.title);
  const [editSummary, setEditSummary] = useState(node.summary);
  const [editContent, setEditContent] = useState(node.content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetchNodeClaims(node.id)
      .then((data) => {
        if (active) setClaims(data);
      })
      .catch(() => {
        if (active) setClaims([]);
      });
    return () => {
      active = false;
    };
  }, [node.id, fetchNodeClaims]);

  const connectedEdges = edges.filter(
    (e) => e.fromId === node.id || e.toId === node.id
  );
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    try {
      const res = await askNodeContext(node.id, question.trim());
      setAiAnswer(res.answer);
      setAiModel(res.model || null);
    } finally {
      setAsking(false);
    }
  };

  const handleLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTargetId) return;
    await linkNodes({ fromId: node.id, toId: linkTargetId, edgeType: linkType });
    setLinkTargetId("");
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTitle.trim()) return;
    setSaving(true);
    try {
      await updateNode(node.id, {
        title: editTitle.trim(),
        summary: editSummary.trim(),
        content: editContent,
      });
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-800 bg-slate-950/96 text-slate-200 shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
            <span className="font-medium capitalize text-sky-400">
              {node.kind.replace("_", " ")}
            </span>
            <span aria-hidden="true">·</span>
            <span className="capitalize">{node.cluster}</span>
            {node.needsAttention && (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-amber-400">
                  <AlertTriangle className="h-3 w-3" />
                  <span>Needs Review</span>
                </span>
              </>
            )}
          </div>
          <h2 className="mt-1 truncate text-base font-semibold text-white">
            {node.title}
          </h2>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setIsEditing((v) => !v)}
            aria-label="Edit node"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <Edit3 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="ge-scrollbar flex-1 space-y-6 overflow-y-auto p-5 text-xs">
        {isEditing ? (
          <form onSubmit={handleSaveEdit} className="space-y-3">
            <label className="block text-[11px] font-medium text-slate-400">
              Title
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="block text-[11px] font-medium text-slate-400">
              Summary
              <textarea
                rows={2}
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-white focus:border-sky-500 focus:outline-none"
              />
            </label>
            <label className="block text-[11px] font-medium text-slate-400">
              Content
              <textarea
                rows={6}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{saving ? "Saving..." : "Save Changes"}</span>
              </button>
            </div>
          </form>
        ) : (
          <>
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold text-slate-400">
                Summary
              </h3>
              <p className="text-[13px] leading-relaxed text-slate-200">
                {node.summary}
              </p>
              {node.tags.length > 0 && (
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] text-slate-400">
                  {node.tags.map((tag, idx) => (
                    <React.Fragment key={tag}>
                      {idx > 0 && <span aria-hidden="true">·</span>}
                      <span>#{tag}</span>
                    </React.Fragment>
                  ))}
                </div>
              )}
            </section>

            <section className="border-t border-slate-800/80 pt-4">
              <h3 className="mb-2 text-[11px] font-semibold text-slate-400">
                Document Content
              </h3>
              <pre className="whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-900/70 p-3 font-sans text-xs leading-relaxed text-slate-300">
                {node.content}
              </pre>
            </section>
          </>
        )}

        {claims.length > 0 && (
          <section className="border-t border-slate-800/80 pt-4">
            <h3 className="mb-2 text-[11px] font-semibold text-slate-400">
              Grounded Claims ({claims.length})
            </h3>
            <div className="space-y-2">
              {claims.map((cl) => (
                <div
                  key={cl.id}
                  className="rounded-md border border-slate-800/90 bg-slate-900/50 p-2.5"
                >
                  <p className="text-slate-200">{cl.claimText}</p>
                  <div className="mt-1 font-mono text-[11px] text-slate-400">
                    <span>{cl.locator || "line 1"}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{Math.round(cl.confidence * 100)}% confidence</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="border-t border-slate-800/80 pt-4">
          <h3 className="mb-2 text-[11px] font-semibold text-slate-400">
            Connected Edges ({connectedEdges.length})
          </h3>
          <div className="space-y-1.5">
            {connectedEdges.map((edge) => {
              const otherId = edge.fromId === node.id ? edge.toId : edge.fromId;
              const other = nodeMap.get(otherId);
              if (!other) return null;
              return (
                <div
                  key={edge.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-900/60 px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => setSelectedNodeId(other.id)}
                    className="truncate text-left font-medium text-sky-300 hover:underline"
                  >
                    {other.title}
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="font-mono text-[11px] text-slate-400">
                      {edge.edgeType}
                    </span>
                    <button
                      type="button"
                      onClick={() => unlinkEdge(edge.id)}
                      className="text-slate-500 hover:text-rose-400"
                      aria-label={`Unlink ${other.title}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <form onSubmit={handleLink} className="mt-3 flex gap-1.5">
            <select
              value={linkTargetId}
              onChange={(e) => setLinkTargetId(e.target.value)}
              aria-label="Target node to link"
              className="min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1.5 text-slate-200"
            >
              <option value="">Link to node...</option>
              {nodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.title}
                  </option>
                ))}
            </select>
            <select
              value={linkType}
              onChange={(e) => setLinkType(e.target.value as GraphEdgeType)}
              aria-label="Relationship type"
              className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-slate-200"
            >
              <option value="relates_to">relates_to</option>
              <option value="supports">supports</option>
              <option value="depends_on">depends_on</option>
              <option value="implements">implements</option>
              <option value="derived_from">derived_from</option>
              <option value="contradicts">contradicts</option>
            </select>
            <button
              type="submit"
              disabled={!linkTargetId}
              aria-label="Create link"
              className="flex shrink-0 items-center gap-1 rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
          </form>
        </section>

        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-sky-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span>AI Subgraph Context</span>
            </div>
            {aiModel && (
              <span className="font-mono text-[10px] text-slate-400">
                {aiModel}
              </span>
            )}
          </div>
          <form onSubmit={handleAsk} className="flex gap-1.5">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about this node and its neighbors..."
              className="min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={asking || !question.trim()}
              className="shrink-0 rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              {asking ? "Asking..." : "Ask"}
            </button>
          </form>
          {aiAnswer && (
            <div className="mt-3 whitespace-pre-wrap rounded-md border border-slate-800 bg-slate-950/90 p-3 leading-relaxed text-slate-200">
              {aiAnswer}
            </div>
          )}
        </section>

        <section className="border-t border-slate-800/80 pt-3 font-mono text-[11px] text-slate-500">
          <span>
            Coordinates: ({node.x.toFixed(1)}, {node.y.toFixed(1)}, {node.z.toFixed(1)})
          </span>
          <span aria-hidden="true"> · </span>
          <span>Hold Shift + Drag node in 3D to reposition</span>
        </section>
      </div>

      <footer className="flex items-center justify-between border-t border-slate-800 px-5 py-3 text-xs">
        <button
          type="button"
          onClick={() =>
            updateNode(node.id, {
              reviewState: "approved",
              needsAttention: false,
            })
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 font-medium text-emerald-300 hover:bg-emerald-500/25"
        >
          <Check className="h-3.5 w-3.5" />
          <span>Approve Node</span>
        </button>
        <button
          type="button"
          onClick={async () => {
            await deleteNode(node.id);
            onClose();
          }}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 font-medium text-rose-300 hover:bg-rose-500/25"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </button>
      </footer>
    </aside>
  );
}

export function NodeInspector({ node, onClose }: NodeInspectorProps) {
  if (!node) return null;
  return <NodeInspectorBody key={node.id} node={node} onClose={onClose} />;
}
