"use client";

import React, { useState } from "react";
import { Eye, Focus, Link2, Sparkles, Trash2, X } from "lucide-react";
import type { ContextMenuState, GraphEdgeType, GraphNode } from "../types";
import { useGraph } from "../hooks/useGraph";

interface GraphContextMenuProps {
  menu: ContextMenuState;
  onClose: () => void;
  onInspectNode: (node: GraphNode) => void;
}

const EDGE_TYPES: GraphEdgeType[] = [
  "relates_to",
  "supports",
  "depends_on",
  "implements",
  "derived_from",
  "mentions",
  "contradicts",
];

function ContextMenuBody({
  node,
  x,
  y,
  onClose,
  onInspectNode,
}: {
  node: GraphNode;
  x: number;
  y: number;
  onClose: () => void;
  onInspectNode: (node: GraphNode) => void;
}) {
  const {
    nodes,
    setSelectedNodeId,
    setFocusIsolation,
    linkNodes,
    deleteNode,
  } = useGraph();

  const [isLinking, setIsLinking] = useState(false);
  const [targetId, setTargetId] = useState("");
  const [edgeType, setEdgeType] = useState<GraphEdgeType>("relates_to");
  const [busy, setBusy] = useState(false);

  const candidateTargets = nodes.filter((n) => n.id !== node.id);

  const handleConfirmLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return;
    setBusy(true);
    try {
      await linkNodes({ fromId: node.id, toId: targetId, edgeType });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await deleteNode(node.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed z-50 w-64 rounded-lg border border-slate-700/90 bg-slate-950/98 p-1.5 text-xs text-slate-200 shadow-2xl"
      style={{
        left: Math.min(
          x,
          typeof window !== "undefined" ? window.innerWidth - 270 : x
        ),
        top: Math.min(
          y,
          typeof window !== "undefined" ? window.innerHeight - 280 : y
        ),
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between border-b border-slate-800 px-2.5 py-1.5">
        <span className="truncate font-semibold text-slate-100">{node.title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close context menu"
          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {!isLinking ? (
        <div className="mt-1 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => {
              onInspectNode(node);
              onClose();
            }}
            className="flex items-center gap-2 rounded px-2.5 py-2 text-left transition-colors hover:bg-slate-800/90"
          >
            <Eye className="h-3.5 w-3.5 text-sky-400" />
            <span>Inspect Node &amp; Claims</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedNodeId(node.id);
              setFocusIsolation(true);
              onClose();
            }}
            className="flex items-center gap-2 rounded px-2.5 py-2 text-left transition-colors hover:bg-slate-800/90"
          >
            <Focus className="h-3.5 w-3.5 text-emerald-400" />
            <span>Isolate 2-Hop Neighborhood</span>
          </button>

          <button
            type="button"
            onClick={() => setIsLinking(true)}
            className="flex items-center gap-2 rounded px-2.5 py-2 text-left transition-colors hover:bg-slate-800/90"
          >
            <Link2 className="h-3.5 w-3.5 text-purple-400" />
            <span>Link to Another Node...</span>
          </button>

          <button
            type="button"
            onClick={() => {
              onInspectNode(node);
              onClose();
            }}
            className="flex items-center gap-2 rounded px-2.5 py-2 text-left transition-colors hover:bg-slate-800/90"
          >
            <Sparkles className="h-3.5 w-3.5 text-amber-400" />
            <span>Ask AI About Subgraph</span>
          </button>

          <div className="my-1 border-t border-slate-800" />

          <button
            type="button"
            disabled={busy}
            onClick={handleDelete}
            className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-rose-400 transition-colors hover:bg-rose-950/60 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete Node</span>
          </button>
        </div>
      ) : (
        <form onSubmit={handleConfirmLink} className="mt-1.5 flex flex-col gap-2.5 p-2">
          <label className="text-[11px] text-slate-400">
            Target Node
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              required
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
            >
              <option value="">Select node...</option>
              {candidateTargets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} ({t.kind})
                </option>
              ))}
            </select>
          </label>

          <label className="text-[11px] text-slate-400">
            Edge Type
            <select
              value={edgeType}
              onChange={(e) => setEdgeType(e.target.value as GraphEdgeType)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-slate-100"
            >
              {EDGE_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et}
                </option>
              ))}
            </select>
          </label>

          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => setIsLinking(false)}
              className="rounded border border-slate-700 px-2.5 py-1 text-slate-300 hover:bg-slate-800"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={busy || !targetId}
              className="rounded bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500 disabled:opacity-50"
            >
              Link
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function GraphContextMenu({
  menu,
  onClose,
  onInspectNode,
}: GraphContextMenuProps) {
  if (!menu.open || !menu.node) return null;

  return (
    <ContextMenuBody
      key={`${menu.node.id}-${menu.x}-${menu.y}`}
      node={menu.node}
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      onInspectNode={onInspectNode}
    />
  );
}
