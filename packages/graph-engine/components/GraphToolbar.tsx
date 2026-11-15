"use client";

import React, { useState } from "react";
import {
  Activity,
  Boxes,
  Calendar,
  ChevronDown,
  ChevronUp,
  Circle,
  Compass,
  Eye,
  Filter,
  Focus,
  FolderSync,
  GitFork,
  Layers,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
} from "lucide-react";
import {
  DEFAULT_GRAPH_THEMES,
  DEFAULT_NODE_KIND_META,
} from "../services/layouts";
import type { GraphLayoutMode, GraphNodeKind, GraphThemeId } from "../types";
import { useGraph } from "../hooks/useGraph";
import { GraphSearch } from "./GraphSearch";

interface GraphToolbarProps {
  title?: string;
  onOpenCreateModal?: () => void;
}

const LAYOUTS: Array<{ id: GraphLayoutMode; label: string; icon: React.ReactNode }> = [
  { id: "orbit", label: "Orbit", icon: <Radio className="h-3.5 w-3.5" /> },
  { id: "rings", label: "Rings", icon: <Circle className="h-3.5 w-3.5" /> },
  { id: "circle", label: "Circle", icon: <Layers className="h-3.5 w-3.5" /> },
  { id: "areas", label: "Clusters", icon: <Boxes className="h-3.5 w-3.5" /> },
  { id: "links", label: "Links", icon: <GitFork className="h-3.5 w-3.5" /> },
  { id: "timeline", label: "Timeline", icon: <Calendar className="h-3.5 w-3.5" /> },
];

export function GraphToolbar({
  title = "Cortex Graph Engine",
  onOpenCreateModal,
}: GraphToolbarProps) {
  const {
    filteredNodes,
    nodes,
    edges,
    layout,
    setLayout,
    themeId,
    setThemeId,
    selectedKind,
    setSelectedKind,
    selectedCluster,
    setSelectedCluster,
    clusterHubs,
    focusIsolation,
    setFocusIsolation,
    showHeatmap,
    setShowHeatmap,
    labelMode,
    setLabelMode,
    motionEnabled,
    setMotionEnabled,
    viewAngle,
    setViewAngle,
    triggerCameraReset,
    creatorDrawerOpen,
    setCreatorDrawerOpen,
    syncVault,
    isSyncingVault,
  } = useGraph();

  const [dockCollapsed, setDockCollapsed] = useState(false);

  return (
    <>
      {/* Minimal Top Bar: 3-zone structure keeping 3D viewport unobstructed */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 px-5 py-3.5">
        <div className="pointer-events-auto flex items-center gap-4">
          <span className="font-display text-base font-semibold tracking-tight text-white whitespace-nowrap shrink-0">
            {title}
          </span>
          <span className="hidden sm:inline font-mono text-xs text-slate-400 whitespace-nowrap shrink-0">
            {filteredNodes.length}/{nodes.length} nodes · {edges.length} edges
          </span>
        </div>

        <div className="pointer-events-auto flex items-center gap-2.5">
          <GraphSearch />
          <button
            type="button"
            onClick={() => setCreatorDrawerOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
              creatorDrawerOpen
                ? "border-sky-500/60 bg-sky-500/20 text-sky-200"
                : "border-slate-700/80 bg-slate-900/95 text-slate-200 hover:border-slate-600 hover:text-white"
            }`}
          >
            <Compass className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Creator OS</span>
          </button>
          <button
            type="button"
            onClick={() => syncVault({ enableAiEnrichment: false }).catch(() => {})}
            disabled={isSyncingVault}
            title="Sync ./CortexVault Markdown notes into PGlite"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/95 px-3 py-1.5 text-xs font-medium text-slate-200 whitespace-nowrap shrink-0 transition-colors hover:border-emerald-500/60 hover:text-emerald-200 disabled:opacity-50"
          >
            <FolderSync className={`h-3.5 w-3.5 ${isSyncingVault ? "animate-spin" : ""}`} />
            <span className="hidden lg:inline">{isSyncingVault ? "Syncing..." : "Sync Vault"}</span>
          </button>
          {onOpenCreateModal && (
            <button
              type="button"
              onClick={onOpenCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-sky-500"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Node</span>
            </button>
          )}
        </div>
      </header>

      {/* Collapsible Bottom Control Dock (Zero Viewport Occlusion) */}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex flex-col items-center px-3">
        <button
          type="button"
          onClick={() => setDockCollapsed((v) => !v)}
          className="pointer-events-auto mb-1.5 inline-flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/92 px-3 py-1 text-[11px] font-medium text-slate-300 transition-colors hover:text-white whitespace-nowrap shrink-0"
        >
          {dockCollapsed ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              <span>Show Controls</span>
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              <span>Hide Controls</span>
            </>
          )}
        </button>

        {!dockCollapsed && (
          <div className="pointer-events-auto flex max-w-[95vw] flex-wrap items-center justify-center gap-2 rounded-xl border border-slate-800/90 bg-slate-950/94 px-3 py-2 shadow-2xl">
            {/* Layout Switcher */}
            <div className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-900/90 p-0.5">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLayout(l.id)}
                  title={`${l.label} layout`}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                    layout === l.id
                      ? "bg-sky-500/20 text-sky-300"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {l.icon}
                  <span className="hidden lg:inline">{l.label}</span>
                </button>
              ))}
            </div>

            {/* Kind & Cluster Filters */}
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5">
                <Filter className="h-3 w-3 text-slate-400" />
                <select
                  value={selectedKind}
                  onChange={(e) =>
                    setSelectedKind(e.target.value as GraphNodeKind | "all")
                  }
                  aria-label="Filter by node kind"
                  className="bg-transparent text-xs text-slate-200 focus:outline-none"
                >
                  <option value="all" className="bg-slate-950">
                    All Kinds
                  </option>
                  {Object.values(DEFAULT_NODE_KIND_META).map((k) => (
                    <option key={k.kind} value={k.kind} className="bg-slate-950">
                      {k.label}
                    </option>
                  ))}
                </select>
              </div>

              <select
                value={selectedCluster}
                onChange={(e) => setSelectedCluster(e.target.value)}
                aria-label="Filter by cluster"
                className="rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
              >
                <option value="all" className="bg-slate-950">
                  All Clusters
                </option>
                {Object.values(clusterHubs).map((c) => (
                  <option key={c.key} value={c.key} className="bg-slate-950">
                    {c.label}
                  </option>
                ))}
              </select>

              <select
                value={themeId}
                onChange={(e) => setThemeId(e.target.value as GraphThemeId)}
                aria-label="Select graph color theme"
                className="rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none"
              >
                {Object.values(DEFAULT_GRAPH_THEMES).map((t) => (
                  <option key={t.id} value={t.id} className="bg-slate-950">
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Graph State & Camera Toggles */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFocusIsolation((v) => !v)}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  focusIsolation
                    ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-300"
                    : "border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white"
                }`}
              >
                <Focus className="h-3.5 w-3.5" />
                <span>Isolate</span>
              </button>

              <button
                type="button"
                onClick={() => setShowHeatmap((v) => !v)}
                className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                  showHeatmap
                    ? "border-amber-500/60 bg-amber-500/20 text-amber-300"
                    : "border-slate-800 bg-slate-900/90 text-slate-300 hover:text-white"
                }`}
              >
                <Activity className="h-3.5 w-3.5" />
                <span>Health</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setLabelMode(
                    labelMode === "anchors"
                      ? "all"
                      : labelMode === "all"
                      ? "none"
                      : "anchors"
                  )
                }
                className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-xs font-medium capitalize text-slate-300 whitespace-nowrap shrink-0 hover:text-white"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Labels: {labelMode}</span>
              </button>

              <button
                type="button"
                onClick={() => setViewAngle(viewAngle === "3d" ? "topdown" : "3d")}
                className="rounded-lg border border-slate-800 bg-slate-900/90 px-2.5 py-1.5 text-xs font-medium text-slate-300 whitespace-nowrap shrink-0 hover:text-white"
              >
                {viewAngle === "3d" ? "3D View" : "Top View"}
              </button>

              <button
                type="button"
                onClick={() => setMotionEnabled((v) => !v)}
                aria-label={motionEnabled ? "Pause drift" : "Resume drift"}
                title={motionEnabled ? "Pause subtle orbit drift" : "Resume subtle orbit drift"}
                className="rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 text-slate-300 hover:text-white"
              >
                {motionEnabled ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </button>

              <button
                type="button"
                onClick={triggerCameraReset}
                aria-label="Reset camera"
                title="Reset camera view"
                className="rounded-lg border border-slate-800 bg-slate-900/90 p-1.5 text-slate-300 hover:text-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
