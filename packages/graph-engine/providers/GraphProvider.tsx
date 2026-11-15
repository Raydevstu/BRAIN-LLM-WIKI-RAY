"use client";

import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  computeGraphLayouts,
  DEFAULT_CLUSTER_HUBS,
  DEFAULT_GRAPH_THEMES,
  findLocalNeighbors,
} from "../services/layouts";
import type {
  ClusterHubConfig,
  CreateGraphNodeInput,
  GraphEdge,
  GraphLayoutMode,
  GraphNode,
  GraphNodeKind,
  GraphSearchResult,
  GraphStorageAdapter,
  GraphSubgraph,
  GraphThemeConfig,
  GraphThemeId,
  KnowledgeClaim,
  LinkGraphNodesInput,
  UpdateGraphNodeInput,
  WikiDigestResult,
} from "../types";

export interface GraphContextValue {
  nodes: GraphNode[];
  edges: GraphEdge[];
  filteredNodes: GraphNode[];
  isLoading: boolean;
  error: string | null;
  selectedNodeId: string | null;
  selectedNode: GraphNode | null;
  hoveredNodeId: string | null;
  layout: GraphLayoutMode;
  theme: GraphThemeConfig;
  themeId: GraphThemeId;
  searchQuery: string;
  selectedCluster: string | "all";
  selectedKind: GraphNodeKind | "all";
  focusIsolation: boolean;
  onlyNeedsAttention: boolean;
  showHeatmap: boolean;
  labelMode: "anchors" | "all" | "none";
  motionEnabled: boolean;
  viewAngle: "3d" | "topdown";
  cameraResetTick: number;
  activeFocusSet: Set<string> | null;
  clusterHubs: Record<string, ClusterHubConfig>;
  setSelectedNodeId: (id: string | null) => void;
  setHoveredNodeId: (id: string | null) => void;
  setLayout: (layout: GraphLayoutMode) => void;
  setThemeId: (theme: GraphThemeId) => void;
  setSearchQuery: (q: string) => void;
  setSelectedCluster: (cluster: string | "all") => void;
  setSelectedKind: (kind: GraphNodeKind | "all") => void;
  setFocusIsolation: React.Dispatch<React.SetStateAction<boolean>>;
  setOnlyNeedsAttention: React.Dispatch<React.SetStateAction<boolean>>;
  setShowHeatmap: React.Dispatch<React.SetStateAction<boolean>>;
  setLabelMode: (mode: "anchors" | "all" | "none") => void;
  setMotionEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setViewAngle: (angle: "3d" | "topdown") => void;
  triggerCameraReset: () => void;
  refreshGraph: (rootId?: string, depth?: number) => Promise<void>;
  createNode: (input: CreateGraphNodeInput) => Promise<GraphNode>;
  updateNode: (id: string, input: UpdateGraphNodeInput) => Promise<GraphNode>;
  deleteNode: (id: string) => Promise<void>;
  linkNodes: (input: LinkGraphNodesInput) => Promise<GraphEdge>;
  unlinkEdge: (edgeId: string) => Promise<void>;
  searchServer: (query: string, limit?: number) => Promise<GraphSearchResult[]>;
  fetchNodeClaims: (nodeId: string) => Promise<KnowledgeClaim[]>;
  askNodeContext: (
    nodeId: string,
    question: string
  ) => Promise<{ answer: string; model?: string }>;
  digestNote: (rawNote: string, categories?: string[]) => Promise<WikiDigestResult>;
}

export const GraphContext = createContext<GraphContextValue | null>(null);

export function createRestStorageAdapter(
  basePath = "/api/graph"
): GraphStorageAdapter {
  const cleanBase = basePath.replace(/\/+$/, "");

  return {
    async fetchGraph(rootId = "all", depth = 2): Promise<GraphSubgraph> {
      const res = await fetch(
        `${cleanBase}/${encodeURIComponent(rootId)}?depth=${depth}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Failed to fetch graph (${res.status})`);
      return res.json();
    },
    async createNode(input) {
      const res = await fetch(`${cleanBase}/nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Failed to create node (${res.status})`);
      return res.json();
    },
    async updateNode(id, input) {
      const res = await fetch(`${cleanBase}/nodes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Failed to update node (${res.status})`);
      const data = await res.json();
      return data.node;
    },
    async deleteNode(id) {
      const res = await fetch(`${cleanBase}/nodes/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to delete node (${res.status})`);
    },
    async linkNodes(input) {
      const res = await fetch(`${cleanBase}/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) throw new Error(`Failed to link nodes (${res.status})`);
      const data = await res.json();
      return data.edge;
    },
    async unlinkEdge(edgeId) {
      const res = await fetch(`${cleanBase}/edges/${encodeURIComponent(edgeId)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Failed to unlink edge (${res.status})`);
    },
    async searchGraph(query, limit = 15) {
      const res = await fetch(
        `${cleanBase}/search?q=${encodeURIComponent(query)}&limit=${limit}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      const data = await res.json();
      return data.results || [];
    },
    async fetchNodeClaims(nodeId) {
      const res = await fetch(
        `${cleanBase}/nodes/${encodeURIComponent(nodeId)}/claims`,
        { cache: "no-store" }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return data.claims || [];
    },
    async askNodeContext(nodeId, question) {
      const res = await fetch(
        `${cleanBase}/nodes/${encodeURIComponent(nodeId)}/context`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question }),
        }
      );
      if (!res.ok) throw new Error(`Context query failed (${res.status})`);
      return res.json();
    },
    async digestNote(rawNote, categories) {
      const res = await fetch(`${cleanBase}/digest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawNote, categories }),
      });
      if (!res.ok) throw new Error(`Digest failed (${res.status})`);
      return res.json();
    },
  };
}

export interface GraphProviderProps {
  children: React.ReactNode;
  apiBasePath?: string;
  storageAdapter?: GraphStorageAdapter;
  rootId?: string;
  initialLayout?: GraphLayoutMode;
  initialTheme?: GraphThemeId;
  clusterHubs?: Record<string, ClusterHubConfig>;
}

export function GraphProvider({
  children,
  apiBasePath = "/api/graph",
  storageAdapter,
  rootId = "all",
  initialLayout = "orbit",
  initialTheme = "obsidian",
  clusterHubs = DEFAULT_CLUSTER_HUBS,
}: GraphProviderProps) {
  const adapter = useMemo(
    () => storageAdapter ?? createRestStorageAdapter(apiBasePath),
    [storageAdapter, apiBasePath]
  );

  const [rawNodes, setRawNodes] = useState<GraphNode[]>([]);
  const [rawEdges, setRawEdges] = useState<GraphEdge[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [layout, setLayout] = useState<GraphLayoutMode>(initialLayout);
  const [themeId, setThemeId] = useState<GraphThemeId>(initialTheme);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCluster, setSelectedCluster] = useState<string | "all">("all");
  const [selectedKind, setSelectedKind] = useState<GraphNodeKind | "all">("all");
  const [focusIsolation, setFocusIsolation] = useState(false);
  const [onlyNeedsAttention, setOnlyNeedsAttention] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [labelMode, setLabelMode] = useState<"anchors" | "all" | "none">("anchors");
  const [motionEnabled, setMotionEnabled] = useState(true);
  const [viewAngle, setViewAngle] = useState<"3d" | "topdown">("3d");
  const [cameraResetTick, setCameraResetTick] = useState(0);

  const { nodes, edges } = useMemo(
    () => computeGraphLayouts(rawNodes, rawEdges, clusterHubs),
    [rawNodes, rawEdges, clusterHubs]
  );

  const refreshGraph = useCallback(
    async (targetRoot = rootId, depth = 2) => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await adapter.fetchGraph(targetRoot, depth);
        setRawNodes(data.nodes || []);
        setRawEdges(data.edges || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoading(false);
      }
    },
    [adapter, rootId]
  );

  useEffect(() => {
    let active = true;
    adapter
      .fetchGraph(rootId, 2)
      .then((data) => {
        if (!active) return;
        setRawNodes(data.nodes || []);
        setRawEdges(data.edges || []);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adapter, rootId]);

  const activeFocusSet = useMemo(() => {
    const focusId = selectedNodeId || hoveredNodeId;
    if (!focusIsolation || !focusId) return null;
    const neighborMap = findLocalNeighbors(focusId, edges, 2);
    return new Set(neighborMap.keys());
  }, [focusIsolation, selectedNodeId, hoveredNodeId, edges]);

  const filteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return nodes.filter((node) => {
      if (selectedCluster !== "all" && node.cluster !== selectedCluster) return false;
      if (selectedKind !== "all" && node.kind !== selectedKind) return false;
      if (onlyNeedsAttention && !node.needsAttention) return false;
      if (activeFocusSet && !activeFocusSet.has(node.id)) return false;
      if (q) {
        const hit =
          node.title.toLowerCase().includes(q) ||
          node.summary.toLowerCase().includes(q) ||
          node.tags.some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [
    nodes,
    selectedCluster,
    selectedKind,
    onlyNeedsAttention,
    activeFocusSet,
    searchQuery,
  ]);

  const createNode = useCallback(
    async (input: CreateGraphNodeInput) => {
      const res = await adapter.createNode(input);
      if (res.createdEdges?.length) {
        await refreshGraph(rootId, 2);
      } else {
        setRawNodes((prev) => [res.node, ...prev]);
      }
      setSelectedNodeId(res.node.id);
      return res.node;
    },
    [adapter, refreshGraph, rootId]
  );

  const updateNode = useCallback(
    async (id: string, input: UpdateGraphNodeInput) => {
      const updated = await adapter.updateNode(id, input);
      setRawNodes((prev) =>
        prev.map((n) => (n.id === id ? { ...n, ...updated } : n))
      );
      return updated;
    },
    [adapter]
  );

  const deleteNode = useCallback(
    async (id: string) => {
      await adapter.deleteNode(id);
      setRawNodes((prev) => prev.filter((n) => n.id !== id));
      setRawEdges((prev) => prev.filter((e) => e.fromId !== id && e.toId !== id));
      setSelectedNodeId((prev) => (prev === id ? null : prev));
    },
    [adapter]
  );

  const linkNodes = useCallback(
    async (input: LinkGraphNodesInput) => {
      const edge = await adapter.linkNodes(input);
      setRawEdges((prev) => [...prev.filter((e) => e.id !== edge.id), edge]);
      return edge;
    },
    [adapter]
  );

  const unlinkEdge = useCallback(
    async (edgeId: string) => {
      await adapter.unlinkEdge(edgeId);
      setRawEdges((prev) => prev.filter((e) => e.id !== edgeId));
    },
    [adapter]
  );

  const searchServer = useCallback(
    (query: string, limit = 15) => adapter.searchGraph(query, limit),
    [adapter]
  );

  const fetchNodeClaims = useCallback(
    async (nodeId: string) => {
      if (adapter.fetchNodeClaims) {
        return adapter.fetchNodeClaims(nodeId);
      }
      return [];
    },
    [adapter]
  );

  const askNodeContext = useCallback(
    async (nodeId: string, question: string) => {
      if (adapter.askNodeContext) {
        return adapter.askNodeContext(nodeId, question);
      }
      const target = nodes.find((n) => n.id === nodeId);
      return {
        answer: target
          ? `${target.title}: ${target.summary}`
          : "Context unavailable for selected node.",
      };
    },
    [adapter, nodes]
  );

  const digestNote = useCallback(
    async (rawNote: string, categories?: string[]): Promise<WikiDigestResult> => {
      if (adapter.digestNote) {
        return adapter.digestNote(rawNote, categories);
      }
      return {
        title: rawNote.split("\n")[0]?.slice(0, 60) || "Untitled Note",
        category: categories?.[0] || "General",
        summary: rawNote.slice(0, 180),
        fullMarkdown: rawNote,
        tags: [],
        connectedConcepts: [],
        importance: "Medium" as const,
      };
    },
    [adapter]
  );

  const triggerCameraReset = useCallback(() => {
    setCameraResetTick((t) => t + 1);
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const value: GraphContextValue = {
    nodes,
    edges,
    filteredNodes,
    isLoading,
    error,
    selectedNodeId,
    selectedNode,
    hoveredNodeId,
    layout,
    theme: DEFAULT_GRAPH_THEMES[themeId],
    themeId,
    searchQuery,
    selectedCluster,
    selectedKind,
    focusIsolation,
    onlyNeedsAttention,
    showHeatmap,
    labelMode,
    motionEnabled,
    viewAngle,
    cameraResetTick,
    activeFocusSet,
    clusterHubs,
    setSelectedNodeId,
    setHoveredNodeId,
    setLayout,
    setThemeId,
    setSearchQuery,
    setSelectedCluster,
    setSelectedKind,
    setFocusIsolation,
    setOnlyNeedsAttention,
    setShowHeatmap,
    setLabelMode,
    setMotionEnabled,
    setViewAngle,
    triggerCameraReset,
    refreshGraph,
    createNode,
    updateNode,
    deleteNode,
    linkNodes,
    unlinkEdge,
    searchServer,
    fetchNodeClaims,
    askNodeContext,
    digestNote,
  };

  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}
