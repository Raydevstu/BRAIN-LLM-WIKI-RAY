"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Compass, Layers } from "lucide-react";
import { useGraph } from "../hooks/useGraph";
import { DEFAULT_NODE_KIND_META } from "../services/layouts";
import type { EgoGraphData, GraphNodeKind } from "../types";

interface CortexFlowNodeData extends Record<string, unknown> {
  label: string;
  kind: string;
  hopDistance: number;
  accentColor: string;
  isCenter: boolean;
  vaultPath?: string | null;
}

function CortexFlowNode({ data }: NodeProps<Node<CortexFlowNodeData>>) {
  return (
    <div
      className={`min-w-[168px] max-w-[220px] rounded-md border bg-slate-950/95 px-3 py-2 text-left shadow-xl transition-colors ${
        data.isCenter
          ? "border-sky-400 ring-1 ring-sky-400/50"
          : "border-slate-700/90 hover:border-slate-500"
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: data.accentColor }}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-500"
      />
      <div className="flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
        <span style={{ color: data.accentColor }}>{data.kind}</span>
        <span>{data.isCenter ? "center" : `hop ${data.hopDistance}`}</span>
      </div>
      <div className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-100">
        {data.label}
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-1.5 !w-1.5 !border-0 !bg-slate-500"
      />
    </div>
  );
}

const NODE_TYPES = {
  cortexNode: CortexFlowNode,
};

const EDGE_COLORS: Record<string, string> = {
  mentions: "#f59e0b",
  cited_in_source: "#38bdf8",
  relates_to: "#10b981",
  references: "#64748b",
  supports: "#22c55e",
  contradicts: "#ef4444",
};

interface EgoGraphFlowProps {
  onSelectNode: (nodeId: string) => void;
}

export function EgoGraphFlow({ onSelectNode }: EgoGraphFlowProps) {
  const { selectedNodeId, nodes: allNodes, fetchEgoGraph, theme } = useGraph();
  const [hops, setHops] = useState<number>(2);
  const [egoData, setEgoData] = useState<EgoGraphData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    fetchEgoGraph(selectedNodeId, hops)
      .then((data) => {
        if (active) setEgoData(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fetchEgoGraph, selectedNodeId, hops, allNodes.length]);

  const handleChangeHops = (nextHops: number) => {
    setLoading(true);
    setHops(nextHops);
  };

  const { flowNodes, flowEdges, centerTitle } = useMemo(() => {
    if (!egoData || egoData.nodes.length === 0) {
      return {
        flowNodes: [] as Node<CortexFlowNodeData>[],
        flowEdges: [] as Edge[],
        centerTitle: "Knowledge Graph",
      };
    }

    const byHop = new Map<number, typeof egoData.nodes>();
    let resolvedCenterTitle = "Knowledge Graph";

    for (const n of egoData.nodes) {
      if (n.hopDistance === 0 || n.id === egoData.centerId) {
        resolvedCenterTitle = n.title;
      }
      const list = byHop.get(n.hopDistance) || [];
      list.push(n);
      byHop.set(n.hopDistance, list);
    }

    const positionedNodes: Node<CortexFlowNodeData>[] = [];
    for (const [hop, group] of byHop.entries()) {
      const baseRadius = hop === 0 ? 0 : hop === 1 ? 250 : hop === 2 ? 470 : 660;
      const count = group.length;
      group.forEach((n, idx) => {
        const angle = (idx / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2;
        const radius =
          hop === 0
            ? 0
            : baseRadius + (count > 10 && idx % 2 === 1 ? 58 : 0);
        const kindMeta =
          DEFAULT_NODE_KIND_META[n.kind as GraphNodeKind] ||
          DEFAULT_NODE_KIND_META.note;

        positionedNodes.push({
          id: n.id,
          type: "cortexNode",
          position: {
            x: Math.round(Math.cos(angle) * radius),
            y: Math.round(Math.sin(angle) * radius),
          },
          data: {
            label: n.title,
            kind: n.kind,
            hopDistance: n.hopDistance,
            accentColor: kindMeta.color,
            isCenter: n.id === egoData.centerId || n.hopDistance === 0,
            vaultPath: n.vaultPath,
          },
        });
      });
    }

    const mappedEdges: Edge[] = egoData.edges.map((e) => {
      const stroke = EDGE_COLORS[e.edgeType.toLowerCase()] || "#475569";
      return {
        id: e.id,
        source: e.fromId,
        target: e.toId,
        type: "smoothstep",
        label: e.edgeType.replace(/_/g, " ").toUpperCase(),
        animated: e.edgeType === "mentions" || e.edgeType === "cited_in_source",
        style: { stroke, strokeWidth: 1.5 },
        labelStyle: {
          fill: "#94a3b8",
          fontSize: 9,
          fontFamily: "var(--font-mono), monospace",
        },
        labelBgStyle: {
          fill: "#020617",
          fillOpacity: 0.85,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 14,
          height: 14,
        },
      };
    });

    return {
      flowNodes: positionedNodes,
      flowEdges: mappedEdges,
      centerTitle: resolvedCenterTitle,
    };
  }, [egoData]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      onSelectNode(node.id);
    },
    [onSelectNode]
  );

  return (
    <div
      className="relative h-full w-full"
      style={{ backgroundColor: theme.canvasBg }}
    >
      {/* Top-Left Ego Controls Bar (Clear of Header) */}
      <div className="pointer-events-auto absolute left-5 top-16 z-20 flex flex-wrap items-center gap-3 rounded-lg border border-slate-800/90 bg-slate-950/92 px-3.5 py-2 text-xs shadow-xl">
        <div className="flex items-center gap-1.5 text-slate-200">
          <Compass className="h-3.5 w-3.5 text-sky-400" />
          <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
            Ego Center:
          </span>
          <span className="max-w-[180px] truncate font-semibold text-white">
            {centerTitle}
          </span>
        </div>

        <div className="flex items-center gap-1 border-l border-slate-800 pl-3">
          <Layers className="h-3.5 w-3.5 text-slate-400" />
          {[1, 2, 3].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => handleChangeHops(h)}
              className={`rounded px-2 py-1 font-mono text-[11px] whitespace-nowrap shrink-0 transition-colors ${
                hops === h
                  ? "bg-sky-500/20 text-sky-300"
                  : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {h} Hop{h > 1 ? "s" : ""}
            </button>
          ))}
        </div>

        <span className="border-l border-slate-800 pl-3 font-mono text-[11px] text-slate-400">
          {loading
            ? "Loading..."
            : `${flowNodes.length} nodes · ${flowEdges.length} edges`}
        </span>
      </div>

      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={22}
          size={1}
          color="#1e293b"
        />
        <Controls className="!border-slate-800 !bg-slate-950 !text-slate-300" />
        <MiniMap
          nodeColor={(n) =>
            (n.data as CortexFlowNodeData | undefined)?.accentColor || "#38bdf8"
          }
          maskColor="rgba(2, 6, 23, 0.78)"
          className="!border !border-slate-800 !bg-slate-950"
        />
      </ReactFlow>
    </div>
  );
}
