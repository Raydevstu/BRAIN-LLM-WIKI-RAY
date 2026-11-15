import * as THREE from "three";
import { DEFAULT_NODE_KIND_META } from "../services/layouts";
import type { GraphNode as GraphNodeModel } from "../types";

export interface NodeMeshBundle {
  mesh: THREE.Mesh;
  node: GraphNodeModel;
  baseScale: THREE.Vector3;
}

export function getNodeDisplayColor(
  node: GraphNodeModel,
  showHeatmap: boolean
): THREE.Color {
  if (showHeatmap) {
    if (node.needsAttention || node.stalenessDays >= 14) {
      return new THREE.Color("#f43f5e");
    }
    if (node.stalenessDays >= 5) {
      return new THREE.Color("#f59e0b");
    }
    return new THREE.Color("#10b981");
  }
  if (node.color) return new THREE.Color(node.color);
  const meta = DEFAULT_NODE_KIND_META[node.kind] || DEFAULT_NODE_KIND_META.note;
  return new THREE.Color(meta.color);
}

export function createNodeMeshBundle(
  node: GraphNodeModel,
  useGeometricShapes: boolean,
  showHeatmap: boolean
): NodeMeshBundle {
  const meta = DEFAULT_NODE_KIND_META[node.kind] || DEFAULT_NODE_KIND_META.note;
  const r = Math.max(3.2, node.radius || 4.8);

  let geometry: THREE.BufferGeometry;
  if (!useGeometricShapes) {
    geometry = new THREE.SphereGeometry(r, 20, 20);
  } else {
    switch (meta.shape) {
      case "cube":
        geometry = new THREE.BoxGeometry(r * 1.45, r * 1.45, r * 1.45);
        break;
      case "diamond":
        geometry = new THREE.OctahedronGeometry(r * 1.15, 0);
        break;
      case "octahedron":
        geometry = new THREE.OctahedronGeometry(r * 0.98, 0);
        break;
      case "cylinder":
        geometry = new THREE.CylinderGeometry(r * 0.85, r * 0.85, r * 1.6, 16);
        break;
      case "torus":
        geometry = new THREE.TorusGeometry(r * 0.85, r * 0.32, 12, 26);
        break;
      case "sphere":
      default:
        geometry = new THREE.SphereGeometry(r, 20, 20);
        break;
    }
  }

  const color = getNodeDisplayColor(node, showHeatmap);
  const material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: node.isKeyAnchor ? 0.52 : 0.24,
    roughness: 0.26,
    metalness: 0.35,
    transparent: true,
    opacity: 0.95,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(node.x, node.y, node.z);
  mesh.userData = { nodeId: node.id, node };

  if (node.isKeyAnchor || node.needsAttention) {
    const ringGeo = new THREE.RingGeometry(r * 1.38, r * 1.64, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: node.needsAttention ? "#f59e0b" : color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    mesh.add(ring);
  }

  return {
    mesh,
    node,
    baseScale: mesh.scale.clone(),
  };
}
