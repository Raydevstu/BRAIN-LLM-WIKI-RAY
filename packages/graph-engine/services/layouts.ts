import type {
  ClusterHubConfig,
  GraphEdge,
  GraphLayoutMode,
  GraphNode,
  GraphNodeKind,
  GraphThemeConfig,
  GraphThemeId,
  NodeKindMeta,
} from "../types";

export const DEFAULT_GRAPH_THEMES: Record<GraphThemeId, GraphThemeConfig> = {
  obsidian: {
    id: "obsidian",
    name: "Stealth Obsidian",
    bg: "#050814",
    canvasBg: "#050814",
    fogColor: "#050814",
    gridColor: "#1e293b",
    textColor: "#e2e8f0",
    accentColor: "#38bdf8",
    lineOpacity: 0.34,
  },
  blueprint: {
    id: "blueprint",
    name: "Paper Blueprint",
    bg: "#081528",
    canvasBg: "#081528",
    fogColor: "#081528",
    gridColor: "#1e3a5f",
    textColor: "#f8fafc",
    accentColor: "#38bdf8",
    lineOpacity: 0.38,
  },
  neon: {
    id: "neon",
    name: "Cyberpunk Neon",
    bg: "#030014",
    canvasBg: "#030014",
    fogColor: "#030014",
    gridColor: "#2e1065",
    textColor: "#f43f5e",
    accentColor: "#f43f5e",
    lineOpacity: 0.4,
  },
  phosphor: {
    id: "phosphor",
    name: "Matrix Phosphor",
    bg: "#020d04",
    canvasBg: "#020d04",
    fogColor: "#020d04",
    gridColor: "#14532d",
    textColor: "#4ade80",
    accentColor: "#22c55e",
    lineOpacity: 0.38,
  },
  amber: {
    id: "amber",
    name: "Solar Amber",
    bg: "#0f0701",
    canvasBg: "#0f0701",
    fogColor: "#0f0701",
    gridColor: "#78350f",
    textColor: "#fbbf24",
    accentColor: "#f59e0b",
    lineOpacity: 0.38,
  },
};

export const DEFAULT_NODE_KIND_META: Record<GraphNodeKind, NodeKindMeta> = {
  project: { kind: "project", label: "Project", shape: "cube", color: "#10b981" },
  note: { kind: "note", label: "Note", shape: "sphere", color: "#38bdf8" },
  artifact: { kind: "artifact", label: "Artifact", shape: "diamond", color: "#a855f7" },
  entity: { kind: "entity", label: "Entity", shape: "octahedron", color: "#f59e0b" },
  concept: { kind: "concept", label: "Concept", shape: "cylinder", color: "#ec4899" },
  wiki_page: { kind: "wiki_page", label: "Wiki Page", shape: "sphere", color: "#14b8a6" },
  collection: { kind: "collection", label: "Collection", shape: "torus", color: "#6366f1" },
  custom: { kind: "custom", label: "Custom", shape: "diamond", color: "#94a3b8" },
};

export const DEFAULT_CLUSTER_HUBS: Record<string, ClusterHubConfig> = {
  general: { key: "general", label: "Core", x: 0, y: 20, z: 0, color: "#a855f7" },
  engineering: { key: "engineering", label: "Engineering", x: -165, y: 12, z: -105, color: "#38bdf8" },
  research: { key: "research", label: "Research", x: 165, y: 15, z: -90, color: "#ec4899" },
  product: { key: "product", label: "Product", x: -155, y: -12, z: 125, color: "#10b981" },
  operations: { key: "operations", label: "Operations", x: 155, y: -15, z: 125, color: "#f59e0b" },
};

const KIND_RING_RADII: Record<GraphNodeKind, { min: number; max: number }> = {
  project: { min: 25, max: 55 },
  collection: { min: 65, max: 100 },
  artifact: { min: 110, max: 150 },
  wiki_page: { min: 160, max: 200 },
  note: { min: 210, max: 250 },
  entity: { min: 260, max: 300 },
  concept: { min: 310, max: 355 },
  custom: { min: 355, max: 390 },
};

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function computeGraphLayouts(
  rawNodes: GraphNode[],
  rawEdges: GraphEdge[],
  clusterHubs: Record<string, ClusterHubConfig> = DEFAULT_CLUSTER_HUBS
): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of rawEdges) {
    if (edge.reviewState === "rejected") continue;
    if (!adjacency.has(edge.fromId)) adjacency.set(edge.fromId, new Set());
    if (!adjacency.has(edge.toId)) adjacency.set(edge.toId, new Set());
    adjacency.get(edge.fromId)!.add(edge.toId);
    adjacency.get(edge.toId)!.add(edge.fromId);
  }

  const nodes: GraphNode[] = rawNodes.map((n, idx) => {
    const mergedConns = Array.from(
      new Set([...(n.connections || []), ...Array.from(adjacency.get(n.id) || [])])
    );
    const seed = hashString(n.id || n.title || String(idx));
    const angle = (idx / Math.max(1, rawNodes.length)) * Math.PI * 2;
    const r = 70 + (seed % 110);
    const orbitPos = {
      x: Number.isFinite(n.x) && n.x !== 0 ? n.x : Number((Math.cos(angle) * r).toFixed(2)),
      y: Number.isFinite(n.y) && n.y !== 0 ? n.y : Number((((seed >> 4) % 130) - 65).toFixed(2)),
      z: Number.isFinite(n.z) && n.z !== 0 ? n.z : Number((Math.sin(angle) * r).toFixed(2)),
    };

    return {
      ...n,
      x: orbitPos.x,
      y: orbitPos.y,
      z: orbitPos.z,
      connections: mergedConns,
      targetPositions: {
        orbit: orbitPos,
        rings: { x: 0, y: 0, z: 0 },
        circle: { x: 0, y: 0, z: 0 },
        areas: { x: 0, y: 0, z: 0 },
        links: { x: 0, y: 0, z: 0 },
        timeline: { x: 0, y: 0, z: 0 },
      },
    };
  });

  const kindBuckets = new Map<GraphNodeKind, GraphNode[]>();
  for (const node of nodes) {
    const list = kindBuckets.get(node.kind) || [];
    list.push(node);
    kindBuckets.set(node.kind, list);
  }

  kindBuckets.forEach((bucket, kind) => {
    const range = KIND_RING_RADII[kind] || KIND_RING_RADII.note;
    const midR = (range.min + range.max) / 2;
    bucket.forEach((node, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, bucket.length);
      node.targetPositions!.rings = {
        x: midR * Math.cos(a),
        y: Math.sin(a * 3) * 10,
        z: midR * Math.sin(a),
      };
    });
  });

  const sortedCircle = [...nodes].sort(
    (a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title)
  );
  sortedCircle.forEach((node, idx) => {
    const a = (2 * Math.PI * idx) / Math.max(1, sortedCircle.length);
    const radius = Math.max(170, sortedCircle.length * 6);
    node.targetPositions!.circle = {
      x: radius * Math.cos(a),
      y: 0,
      z: radius * Math.sin(a),
    };
  });

  const kindOrder: GraphNodeKind[] = [
    "project",
    "collection",
    "artifact",
    "wiki_page",
    "note",
    "entity",
    "concept",
    "custom",
  ];

  nodes.forEach((node, idx) => {
    const hub = clusterHubs[node.cluster] || clusterHubs.general || { x: 0, y: 0, z: 0 };
    const a = (2 * Math.PI * idx) / Math.max(1, nodes.length);
    const dist = 35 + (idx % 5) * 14;
    node.targetPositions!.areas = {
      x: hub.x + dist * Math.cos(a),
      y: hub.y + ((idx % 3) - 1) * 12,
      z: hub.z + dist * Math.sin(a),
    };

    const degree = Math.max(1, node.connections.length);
    const linkRadius = node.isKeyAnchor ? 55 : Math.min(260, 75 + (14 / degree) * 32);
    const kindIdx = Math.max(0, kindOrder.indexOf(node.kind));
    const linkAngle = (kindIdx / kindOrder.length) * Math.PI * 2 + (idx % 9) * 0.25;
    node.targetPositions!.links = {
      x: linkRadius * Math.cos(linkAngle),
      y: ((idx % 5) - 2) * 16,
      z: linkRadius * Math.sin(linkAngle),
    };

    const tx = -260 + (idx / Math.max(1, nodes.length)) * 520;
    const ty = (kindIdx - 3) * 40;
    const tz = Math.sin(tx * 0.025) * 32;
    node.targetPositions!.timeline = { x: tx, y: ty, z: tz };
  });

  return { nodes, edges: rawEdges };
}

export function getNodeTargetCoordinate(
  node: GraphNode,
  layout: GraphLayoutMode
): { x: number; y: number; z: number } {
  return node.targetPositions?.[layout] || { x: node.x, y: node.y, z: node.z };
}

export function findLocalNeighbors(
  startId: string,
  edges: GraphEdge[],
  maxDepth = 2
): Map<string, number> {
  const depthMap = new Map<string, number>([[startId, 0]]);
  const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;

    for (const edge of edges) {
      if (edge.reviewState === "rejected") continue;
      let neighbor: string | null = null;
      if (edge.fromId === current.id) neighbor = edge.toId;
      else if (edge.toId === current.id) neighbor = edge.fromId;

      if (neighbor && !depthMap.has(neighbor)) {
        const nextDepth = current.depth + 1;
        depthMap.set(neighbor, nextDepth);
        queue.push({ id: neighbor, depth: nextDepth });
      }
    }
  }

  return depthMap;
}
