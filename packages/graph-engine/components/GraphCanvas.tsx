"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { useGraph } from "../hooks/useGraph";
import { getNodeTargetCoordinate } from "../services/layouts";
import type { ContextMenuState, GraphNode } from "../types";
import {
  createNodeMeshBundle,
  getNodeDisplayColor,
  type NodeMeshBundle,
} from "./GraphNode";
import { buildEdgeGeometryAndColors } from "./GraphEdge";
import { GraphToolbar } from "./GraphToolbar";
import { GraphContextMenu } from "./GraphContextMenu";
import { NodeInspector } from "./NodeInspector";
import { CreateNodeModal } from "./CreateNodeModal";
import { CreatorDashboard } from "./CreatorDashboard";

// Pre-allocated math helpers outside render loop (zero GC)
const _projVec = new THREE.Vector3();
const _targetPos = new THREE.Vector3();
const _dragPlane = new THREE.Plane();
const _dragHit = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _pointerNdc = new THREE.Vector2();
const _camGoalPos = new THREE.Vector3();
const _camGoalTarget = new THREE.Vector3();

function detectSoftwareWebGL(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return true;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export interface GraphCanvasProps {
  title?: string;
  useGeometricShapes?: boolean;
}

export function GraphCanvas({
  title = "Cortex Graph Engine",
  useGeometricShapes = true,
}: GraphCanvasProps) {
  const {
    nodes,
    edges,
    filteredNodes,
    isLoading,
    error,
    selectedNodeId,
    selectedNode,
    hoveredNodeId,
    layout,
    theme,
    showHeatmap,
    labelMode,
    motionEnabled,
    viewAngle,
    cameraResetTick,
    setSelectedNodeId,
    setHoveredNodeId,
    updateNode,
  } = useGraph();

  const mountRef = useRef<HTMLDivElement>(null);
  const labelButtonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    node: null,
  });
  const [dismissedNodeId, setDismissedNodeId] = useState<string | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [webglLost, setWebglLost] = useState(false);
  const [webglUnavailable, setWebglUnavailable] = useState(false);

  const inspectorVisible = Boolean(
    selectedNode && dismissedNodeId !== selectedNode.id
  );

  // Refs synced inside useEffect for the imperative Three.js loop
  const stateRef = useRef({
    nodes,
    edges,
    filteredNodes,
    selectedNodeId,
    hoveredNodeId,
    layout,
    theme,
    showHeatmap,
    labelMode,
    motionEnabled,
    viewAngle,
    useGeometricShapes,
  });

  const callbacksRef = useRef({
    setSelectedNodeId,
    setHoveredNodeId,
    updateNode,
    setDismissedNodeId,
    setContextMenu,
  });

  useEffect(() => {
    stateRef.current = {
      nodes,
      edges,
      filteredNodes,
      selectedNodeId,
      hoveredNodeId,
      layout,
      theme,
      showHeatmap,
      labelMode,
      motionEnabled,
      viewAngle,
      useGeometricShapes,
    };
  }, [
    nodes,
    edges,
    filteredNodes,
    selectedNodeId,
    hoveredNodeId,
    layout,
    theme,
    showHeatmap,
    labelMode,
    motionEnabled,
    viewAngle,
    useGeometricShapes,
  ]);

  useEffect(() => {
    callbacksRef.current = {
      setSelectedNodeId,
      setHoveredNodeId,
      updateNode,
      setDismissedNodeId,
      setContextMenu,
    };
  }, [setSelectedNodeId, setHoveredNodeId, updateNode]);

  // Imperative scene handles
  const sceneHandlesRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    nodeGroup: THREE.Group;
    edgeLines: THREE.LineSegments;
    gridHelper: THREE.GridHelper;
    bundles: Map<string, NodeMeshBundle>;
    meshMap: Map<string, THREE.Mesh>;
    draggedNodeId: string | null;
    manualPositions: Map<string, { x: number; y: number; z: number }>;
    cameraTransitioning: boolean;
    rebuildSceneGraph: () => void;
    refreshEdgeColors: () => void;
  } | null>(null);

  // Mount Three.js WebGL scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: "high-performance",
      });
    } catch {
      queueMicrotask(() => setWebglUnavailable(true));
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    const onContextLost = (e: Event) => {
      e.preventDefault();
      setWebglLost(true);
    };
    const onContextRestored = () => {
      setWebglLost(false);
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);

    const scene = new THREE.Scene();
    const initTheme = stateRef.current.theme;
    scene.background = new THREE.Color(initTheme.canvasBg);
    scene.fog = new THREE.FogExp2(initTheme.fogColor, 0.00135);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(52, width / height, 1, 2400);
    camera.position.set(0, 140, 340);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.minDistance = 45;
    controls.maxDistance = 950;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.9;

    // 3-point warm/cool lighting rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.75);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1e6, 1.35);
    keyLight.position.set(160, 220, 140);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(0x38bdf8, 1.1, 800);
    rimLight.position.set(-180, -90, -180);
    scene.add(rimLight);

    // Subtle spatial reference grid
    const gridHelper = new THREE.GridHelper(640, 24, initTheme.gridColor, initTheme.gridColor);
    gridHelper.position.y = -110;
    const gridMat = gridHelper.material as THREE.Material;
    gridMat.transparent = true;
    gridMat.opacity = 0.22;
    scene.add(gridHelper);

    const nodeGroup = new THREE.Group();
    scene.add(nodeGroup);

    const edgeGeo = new THREE.BufferGeometry();
    const edgeMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: initTheme.lineOpacity + 0.25,
    });
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
    edgeLines.frustumCulled = false;
    scene.add(edgeLines);

    const bundles = new Map<string, NodeMeshBundle>();
    const meshMap = new Map<string, THREE.Mesh>();
    const manualPositions = new Map<string, { x: number; y: number; z: number }>();

    const refreshEdgeColors = () => {
      const s = stateRef.current;
      const visibleIds = new Set(s.filteredNodes.map((n) => n.id));
      const focusId = s.selectedNodeId || s.hoveredNodeId;
      const { positions, colors } = buildEdgeGeometryAndColors(
        s.edges,
        meshMap,
        visibleIds,
        focusId,
        s.theme
      );
      edgeGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      edgeGeo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      edgeGeo.computeBoundingSphere();
      edgeMat.opacity = s.theme.lineOpacity + 0.3;
    };

    const rebuildSceneGraph = () => {
      const s = stateRef.current;
      const nextIds = new Set(s.nodes.map((n) => n.id));
      const visibleIds = new Set(s.filteredNodes.map((n) => n.id));

      // Dispose removed meshes
      for (const [id, bundle] of bundles.entries()) {
        if (!nextIds.has(id)) {
          nodeGroup.remove(bundle.mesh);
          bundle.mesh.geometry.dispose();
          (bundle.mesh.material as THREE.Material).dispose();
          bundles.delete(id);
          meshMap.delete(id);
        }
      }

      // Add or update meshes
      for (const node of s.nodes) {
        const existing = bundles.get(node.id);
        if (!existing) {
          const bundle = createNodeMeshBundle(
            node,
            s.useGeometricShapes,
            s.showHeatmap
          );
          const target = getNodeTargetCoordinate(node, s.layout);
          bundle.mesh.position.set(target.x, target.y, target.z);
          nodeGroup.add(bundle.mesh);
          bundles.set(node.id, bundle);
          meshMap.set(node.id, bundle.mesh);
        } else {
          existing.node = node;
          existing.mesh.userData.node = node;
          const mat = existing.mesh.material as THREE.MeshStandardMaterial;
          const col = getNodeDisplayColor(node, s.showHeatmap);
          mat.color.copy(col);
          mat.emissive.copy(col);
        }
        const mesh = meshMap.get(node.id)!;
        mesh.visible = visibleIds.has(node.id);
      }

      refreshEdgeColors();
    };

    sceneHandlesRef.current = {
      scene,
      camera,
      controls,
      nodeGroup,
      edgeLines,
      gridHelper,
      bundles,
      meshMap,
      draggedNodeId: null,
      manualPositions,
      cameraTransitioning: false,
      rebuildSceneGraph,
      refreshEdgeColors,
    };

    controls.addEventListener("start", () => {
      if (sceneHandlesRef.current) {
        sceneHandlesRef.current.cameraTransitioning = false;
      }
    });

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    rebuildSceneGraph();

    // Pointer interaction state
    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverRaycast = 0;

    const updateNdc = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    };

    const raycastVisibleNodes = (): THREE.Mesh | null => {
      _raycaster.setFromCamera(_pointerNdc, camera);
      const visibleMeshes: THREE.Mesh[] = [];
      for (const m of meshMap.values()) {
        if (m.visible) visibleMeshes.push(m);
      }
      const hits = _raycaster.intersectObjects(visibleMeshes, false);
      return hits.length > 0 ? (hits[0].object as THREE.Mesh) : null;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      callbacksRef.current.setContextMenu((prev) =>
        prev.open ? { ...prev, open: false } : prev
      );

      if (e.button === 0 && e.shiftKey) {
        updateNdc(e.clientX, e.clientY);
        const hitMesh = raycastVisibleNodes();
        if (hitMesh && sceneHandlesRef.current) {
          const nodeId = hitMesh.userData.nodeId as string;
          sceneHandlesRef.current.draggedNodeId = nodeId;
          controls.enabled = false;
          camera.getWorldDirection(_camDir);
          _dragPlane.setFromNormalAndCoplanarPoint(_camDir.negate(), hitMesh.position);
          renderer.domElement.style.cursor = "grabbing";
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const handles = sceneHandlesRef.current;
      if (!handles) return;

      if (handles.draggedNodeId) {
        updateNdc(e.clientX, e.clientY);
        _raycaster.setFromCamera(_pointerNdc, camera);
        if (_raycaster.ray.intersectPlane(_dragPlane, _dragHit)) {
          const mesh = meshMap.get(handles.draggedNodeId);
          if (mesh) {
            mesh.position.copy(_dragHit);
            handles.manualPositions.set(handles.draggedNodeId, {
              x: Number(_dragHit.x.toFixed(2)),
              y: Number(_dragHit.y.toFixed(2)),
              z: Number(_dragHit.z.toFixed(2)),
            });
            handles.refreshEdgeColors();
          }
        }
        return;
      }

      const now = performance.now();
      if (now - lastHoverRaycast < 40) return;
      lastHoverRaycast = now;

      updateNdc(e.clientX, e.clientY);
      const hitMesh = raycastVisibleNodes();
      const nextHoverId = hitMesh ? (hitMesh.userData.nodeId as string) : null;
      renderer.domElement.style.cursor = hitMesh
        ? e.shiftKey
          ? "grab"
          : "pointer"
        : "default";
      if (stateRef.current.hoveredNodeId !== nextHoverId) {
        callbacksRef.current.setHoveredNodeId(nextHoverId);
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const handles = sceneHandlesRef.current;
      if (handles?.draggedNodeId) {
        const draggedId = handles.draggedNodeId;
        const pos = handles.manualPositions.get(draggedId);
        handles.draggedNodeId = null;
        controls.enabled = true;
        renderer.domElement.style.cursor = "default";
        if (pos) {
          void callbacksRef.current.updateNode(draggedId, pos);
        }
        return;
      }

      if (e.button !== 0) return;
      const dx = e.clientX - pointerDownPos.x;
      const dy = e.clientY - pointerDownPos.y;
      if (Math.hypot(dx, dy) > 5) return;

      updateNdc(e.clientX, e.clientY);
      const hitMesh = raycastVisibleNodes();
      if (hitMesh) {
        const nodeId = hitMesh.userData.nodeId as string;
        callbacksRef.current.setSelectedNodeId(nodeId);
        callbacksRef.current.setDismissedNodeId(null);
      } else {
        callbacksRef.current.setSelectedNodeId(null);
      }
    };

    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      updateNdc(e.clientX, e.clientY);
      const hitMesh = raycastVisibleNodes();
      if (hitMesh) {
        const node = hitMesh.userData.node as GraphNode;
        callbacksRef.current.setSelectedNodeId(node.id);
        callbacksRef.current.setContextMenu({
          open: true,
          x: e.clientX,
          y: e.clientY,
          node,
        });
      } else {
        callbacksRef.current.setContextMenu({
          open: false,
          x: 0,
          y: 0,
          node: null,
        });
      }
    };

    const domEl = renderer.domElement;
    domEl.addEventListener("pointerdown", onPointerDown);
    domEl.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    domEl.addEventListener("contextmenu", onContextMenu);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // Animation loop with software WebGL afterDraw pacing
    let frameId = 0;
    let disposed = false;
    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (!gl || typeof gl.fenceSync !== "function") {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function updateProjectedLabels(w: number, h: number) {
      const s = stateRef.current;
      const focusId = s.selectedNodeId || s.hoveredNodeId;
      const focusNode = focusId ? s.nodes.find((n) => n.id === focusId) : null;
      const neighborIds = new Set<string>(focusNode?.connections || []);

      for (const node of s.filteredNodes) {
        const btn = labelButtonsRef.current.get(node.id);
        const mesh = meshMap.get(node.id);
        if (!btn || !mesh) continue;

        const showThis =
          s.labelMode === "all" ||
          (s.labelMode === "anchors" &&
            (node.isKeyAnchor ||
              node.id === s.selectedNodeId ||
              node.id === s.hoveredNodeId ||
              neighborIds.has(node.id)));

        if (!showThis) {
          btn.style.opacity = "0";
          btn.style.pointerEvents = "none";
          continue;
        }

        _projVec.copy(mesh.position);
        _projVec.y += (node.radius || 5) + 4.5;
        _projVec.project(camera);

        if (_projVec.z > 1 || _projVec.z < -1) {
          btn.style.opacity = "0";
          btn.style.pointerEvents = "none";
          continue;
        }

        const sx = (_projVec.x * 0.5 + 0.5) * w;
        const sy = (-_projVec.y * 0.5 + 0.5) * h;

        if (sx < -60 || sx > w + 60 || sy < -30 || sy > h + 30) {
          btn.style.opacity = "0";
          btn.style.pointerEvents = "none";
          continue;
        }

        btn.style.opacity =
          focusId && node.id !== focusId && !neighborIds.has(node.id)
            ? "0.55"
            : "1";
        btn.style.pointerEvents = "auto";
        btn.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(
          1
        )}px, 0) translate(-50%, -100%)`;
      }
    }

    function tick() {
      if (disposed) return;
      const delta = Math.min(0.05, clock.getDelta());
      const elapsed = clock.getElapsedTime();
      const s = stateRef.current;
      const handles = sceneHandlesRef.current;
      if (!handles) return;

      // Smoothly damp camera when switching 3D / TopDown or Reset
      if (handles.cameraTransitioning) {
        camera.position.x = THREE.MathUtils.damp(
          camera.position.x,
          _camGoalPos.x,
          6,
          delta
        );
        camera.position.y = THREE.MathUtils.damp(
          camera.position.y,
          _camGoalPos.y,
          6,
          delta
        );
        camera.position.z = THREE.MathUtils.damp(
          camera.position.z,
          _camGoalPos.z,
          6,
          delta
        );
        controls.target.x = THREE.MathUtils.damp(
          controls.target.x,
          _camGoalTarget.x,
          6,
          delta
        );
        controls.target.y = THREE.MathUtils.damp(
          controls.target.y,
          _camGoalTarget.y,
          6,
          delta
        );
        controls.target.z = THREE.MathUtils.damp(
          controls.target.z,
          _camGoalTarget.z,
          6,
          delta
        );
        if (camera.position.distanceTo(_camGoalPos) < 0.8) {
          handles.cameraTransitioning = false;
        }
      }

      // Smoothly damp node positions toward active layout targets
      let edgesDirty = false;
      for (const [id, bundle] of bundles.entries()) {
        if (!bundle.mesh.visible) continue;
        if (handles.draggedNodeId === id) {
          edgesDirty = true;
          continue;
        }

        const override =
          s.layout === "orbit" ? handles.manualPositions.get(id) : undefined;
        const coord = override || getNodeTargetCoordinate(bundle.node, s.layout);
        const driftY =
          s.motionEnabled && s.layout === "orbit"
            ? Math.sin(elapsed * 0.9 + coord.x * 0.03) * 1.4
            : 0;

        _targetPos.set(coord.x, coord.y + driftY, coord.z);
        const dist = bundle.mesh.position.distanceTo(_targetPos);
        if (dist > 0.05) {
          bundle.mesh.position.x = THREE.MathUtils.damp(
            bundle.mesh.position.x,
            _targetPos.x,
            7,
            delta
          );
          bundle.mesh.position.y = THREE.MathUtils.damp(
            bundle.mesh.position.y,
            _targetPos.y,
            7,
            delta
          );
          bundle.mesh.position.z = THREE.MathUtils.damp(
            bundle.mesh.position.z,
            _targetPos.z,
            7,
            delta
          );
          edgesDirty = true;
        }

        // Subtle focus scale emphasis
        const isSelected = id === s.selectedNodeId;
        const isHovered = id === s.hoveredNodeId;
        const targetScale = isSelected ? 1.32 : isHovered ? 1.18 : 1.0;
        const nextScale = THREE.MathUtils.damp(
          bundle.mesh.scale.x,
          targetScale,
          10,
          delta
        );
        bundle.mesh.scale.setScalar(nextScale);
        if (bundle.node.kind === "artifact" || bundle.node.kind === "entity") {
          if (s.motionEnabled) {
            bundle.mesh.rotation.y += delta * 0.35;
          }
        }
      }

      if (edgesDirty) {
        const posAttr = edgeLines.geometry.getAttribute(
          "position"
        ) as THREE.BufferAttribute | undefined;
        if (posAttr) {
          const visibleIds = new Set(s.filteredNodes.map((n) => n.id));
          let idx = 0;
          for (const edge of s.edges) {
            if (
              edge.reviewState === "rejected" ||
              !visibleIds.has(edge.fromId) ||
              !visibleIds.has(edge.toId)
            ) {
              continue;
            }
            const mFrom = meshMap.get(edge.fromId);
            const mTo = meshMap.get(edge.toId);
            if (!mFrom || !mTo) continue;
            if (idx * 2 + 1 < posAttr.count) {
              posAttr.setXYZ(
                idx * 2,
                mFrom.position.x,
                mFrom.position.y,
                mFrom.position.z
              );
              posAttr.setXYZ(
                idx * 2 + 1,
                mTo.position.x,
                mTo.position.y,
                mTo.position.z
              );
            }
            idx++;
          }
          posAttr.needsUpdate = true;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      const cw = container?.clientWidth || window.innerWidth;
      const ch = container?.clientHeight || window.innerHeight;
      updateProjectedLabels(cw, ch);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);

      domEl.removeEventListener("pointerdown", onPointerDown);
      domEl.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      domEl.removeEventListener("contextmenu", onContextMenu);
      domEl.removeEventListener("webglcontextlost", onContextLost);
      domEl.removeEventListener("webglcontextrestored", onContextRestored);
      window.removeEventListener("resize", onResize);

      controls.dispose();
      envTex.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      gridHelper.geometry.dispose();
      gridMat.dispose();

      for (const bundle of bundles.values()) {
        bundle.mesh.geometry.dispose();
        (bundle.mesh.material as THREE.Material).dispose();
      }
      bundles.clear();
      meshMap.clear();
      renderer.dispose();
      sceneHandlesRef.current = null;
    };
  }, []);

  // Rebuild meshes & edges when graph data, filters, or heatmap change
  useEffect(() => {
    sceneHandlesRef.current?.rebuildSceneGraph();
  }, [nodes, edges, filteredNodes, showHeatmap, useGeometricShapes]);

  // Refresh edge highlights when selection, hover, or theme changes
  useEffect(() => {
    const handles = sceneHandlesRef.current;
    if (!handles) return;
    handles.scene.background = new THREE.Color(theme.canvasBg);
    handles.scene.fog = new THREE.FogExp2(theme.fogColor, 0.00135);
    handles.refreshEdgeColors();
  }, [selectedNodeId, hoveredNodeId, theme]);

  // Trigger smooth camera transition on viewAngle or cameraResetTick changes
  useEffect(() => {
    const handles = sceneHandlesRef.current;
    if (!handles) return;
    _camGoalTarget.set(0, 0, 0);
    if (viewAngle === "topdown") {
      _camGoalPos.set(0, 420, 12);
    } else {
      _camGoalPos.set(0, 140, 340);
    }
    handles.cameraTransitioning = true;
  }, [viewAngle, cameraResetTick]);

  const registerLabelRef = useCallback(
    (id: string) => (el: HTMLButtonElement | null) => {
      if (el) {
        labelButtonsRef.current.set(id, el);
      } else {
        labelButtonsRef.current.delete(id);
      }
    },
    []
  );

  return (
    <div
      className="ge-root relative h-full w-full overflow-hidden select-none"
      style={{ backgroundColor: theme.bg }}
    >
      {/* Dedicated WebGL Mount Ref (Isolated from React HUD children) */}
      <div ref={mountRef} className="absolute inset-0 h-full w-full" />

      {/* WebGL Unavailable or Context Lost Fallback */}
      {(webglUnavailable || webglLost) && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/95 p-6">
          <div className="max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 text-center">
            <h2 className="text-base font-semibold text-white">
              {webglLost ? "3D Viewport Suspended" : "3D Acceleration Unavailable"}
            </h2>
            <p className="mt-2 text-xs text-slate-400">
              Your graph has {nodes.length} nodes and {edges.length} edges indexed in
              PostgreSQL. Use the search bar above to inspect any node directly.
            </p>
          </div>
        </div>
      )}

      {/* Projected 2D DOM Labels */}
      <div className="ge-label-overlay" aria-hidden={labelMode === "none"}>
        {filteredNodes.map((node) => (
          <button
            key={node.id}
            ref={registerLabelRef(node.id)}
            type="button"
            data-selected={node.id === selectedNodeId ? "true" : "false"}
            onClick={() => {
              setSelectedNodeId(node.id);
              setDismissedNodeId(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              setSelectedNodeId(node.id);
              setContextMenu({
                open: true,
                x: e.clientX,
                y: e.clientY,
                node,
              });
            }}
            className="ge-node-label"
            style={{ opacity: 0, pointerEvents: "none" }}
          >
            {node.title}
          </button>
        ))}
      </div>

      {/* Loading & Error Banner */}
      {isLoading && nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-lg border border-slate-800 bg-slate-950/95 px-5 py-3 text-xs font-medium text-slate-300">
            Initializing Knowledge Graph &amp; PostgreSQL Vector Index...
          </div>
        </div>
      )}

      {error && (
        <div className="absolute left-5 top-16 z-30 rounded-lg border border-rose-500/40 bg-rose-950/90 px-3.5 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Controls & Search */}
      <GraphToolbar
        title={title}
        onOpenCreateModal={() => setCreateModalOpen(true)}
      />

      {/* Right-Click Node Context Menu */}
      <GraphContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu((prev) => ({ ...prev, open: false }))}
        onInspectNode={(node) => {
          setSelectedNodeId(node.id);
          setDismissedNodeId(null);
        }}
      />

      {/* Node Detail & AI Context Drawer */}
      {inspectorVisible && selectedNode && (
        <NodeInspector
          node={selectedNode}
          onClose={() => setDismissedNodeId(selectedNode.id)}
        />
      )}

      {/* Creator OS Intelligence & Vault Sync Drawer */}
      <CreatorDashboard
        onSelectNode={(nodeId) => {
          setSelectedNodeId(nodeId);
          setDismissedNodeId(null);
        }}
      />

      {/* Node Creation & AI Digest Modal */}
      <CreateNodeModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
    </div>
  );
}
