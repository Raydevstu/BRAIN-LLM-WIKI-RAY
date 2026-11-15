import * as THREE from "three";
import type { GraphEdge as GraphEdgeModel, GraphThemeConfig } from "../types";

export function buildEdgeGeometryAndColors(
  edges: GraphEdgeModel[],
  meshMap: Map<string, THREE.Mesh>,
  visibleNodeIds: Set<string>,
  focusNodeId: string | null,
  theme: GraphThemeConfig
): { positions: Float32Array; colors: Float32Array } {
  const activeEdges = edges.filter(
    (e) =>
      e.reviewState !== "rejected" &&
      visibleNodeIds.has(e.fromId) &&
      visibleNodeIds.has(e.toId) &&
      meshMap.has(e.fromId) &&
      meshMap.has(e.toId)
  );

  const positions = new Float32Array(activeEdges.length * 6);
  const colors = new Float32Array(activeEdges.length * 6);
  const baseColor = new THREE.Color(theme.gridColor).lerp(
    new THREE.Color(theme.accentColor),
    0.42
  );
  const highlightColor = new THREE.Color(theme.accentColor);

  activeEdges.forEach((edge, idx) => {
    const mFrom = meshMap.get(edge.fromId)!;
    const mTo = meshMap.get(edge.toId)!;
    const offset = idx * 6;

    positions[offset] = mFrom.position.x;
    positions[offset + 1] = mFrom.position.y;
    positions[offset + 2] = mFrom.position.z;
    positions[offset + 3] = mTo.position.x;
    positions[offset + 4] = mTo.position.y;
    positions[offset + 5] = mTo.position.z;

    const isHighlighted =
      focusNodeId !== null &&
      (edge.fromId === focusNodeId || edge.toId === focusNodeId);
    const c = isHighlighted ? highlightColor : baseColor;
    const dim = focusNodeId !== null && !isHighlighted ? 0.25 : 1.0;

    colors[offset] = c.r * dim;
    colors[offset + 1] = c.g * dim;
    colors[offset + 2] = c.b * dim;
    colors[offset + 3] = c.r * dim;
    colors[offset + 4] = c.g * dim;
    colors[offset + 5] = c.b * dim;
  });

  return { positions, colors };
}
