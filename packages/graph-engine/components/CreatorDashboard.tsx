"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Compass,
  FolderSync,
  Flame,
  Inbox,
  Lightbulb,
  Plus,
  RefreshCw,
  Rss,
  Share2,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import { useGraph } from "../hooks/useGraph";
import type {
  CreatorDashboardData,
  EgoGraphData,
  ResearchRunReport,
  ResearchSourceConfig,
  ResearchStatusData,
} from "../types";

interface VaultBrainStatus {
  vaultExists: boolean;
  vaultDir: string;
  hasRepoBrain: boolean;
  generatedAt: string | null;
  estimatedTokens: number;
  contextPack: string;
}

interface CreatorDashboardProps {
  onSelectNode: (nodeId: string) => void;
}

export function CreatorDashboard({ onSelectNode }: CreatorDashboardProps) {
  const {
    creatorDrawerOpen,
    setCreatorDrawerOpen,
    syncVault,
    isSyncingVault,
    lastSyncStats,
    fetchCreatorStats,
    fetchEgoGraph,
    selectedNodeId,
    focusNodeEgo,
    setViewMode,
    refreshGraph,
  } = useGraph();

  const [stats, setStats] = useState<CreatorDashboardData | null>(null);
  const [vaultStatus, setVaultStatus] = useState<VaultBrainStatus | null>(null);
  const [egoSlice, setEgoSlice] = useState<EgoGraphData | null>(null);
  const [researchStatus, setResearchStatus] = useState<ResearchStatusData | null>(null);
  const [lastResearchReport, setLastResearchReport] = useState<ResearchRunReport | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [showFeedsPanel, setShowFeedsPanel] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceKind, setNewSourceKind] = useState<"rss" | "youtube" | "arxiv">("rss");
  const [newSourceTarget, setNewSourceTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [showContextPack, setShowContextPack] = useState(false);

  const refreshCreatorData = useCallback(async () => {
    const [creatorData, brainRes, egoData, researchRes] = await Promise.all([
      fetchCreatorStats(),
      fetch("/api/vault/sync", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetchEgoGraph(selectedNodeId, 2).catch(() => null),
      fetch("/api/research", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    setStats(creatorData);
    if (brainRes) setVaultStatus(brainRes);
    if (egoData) setEgoSlice(egoData);
    if (researchRes) setResearchStatus(researchRes);
  }, [fetchCreatorStats, fetchEgoGraph, selectedNodeId]);

  useEffect(() => {
    if (!creatorDrawerOpen) return;
    let active = true;
    Promise.all([
      fetchCreatorStats(),
      fetch("/api/vault/sync", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetchEgoGraph(selectedNodeId, 2).catch(() => null),
      fetch("/api/research", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ])
      .then(([creatorData, brainRes, egoData, researchRes]) => {
        if (!active) return;
        setStats(creatorData);
        if (brainRes) setVaultStatus(brainRes);
        if (egoData) setEgoSlice(egoData);
        if (researchRes) setResearchStatus(researchRes);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [creatorDrawerOpen, fetchCreatorStats, fetchEgoGraph, selectedNodeId]);

  if (!creatorDrawerOpen) return null;

  const handleResearchAction = async (
    action: "fetch_only" | "process_inbox" | "run_pipeline"
  ) => {
    setResearchBusy(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          report?: ResearchRunReport;
          status?: ResearchStatusData;
        };
        if (data.status) setResearchStatus(data.status);
        if (data.report) setLastResearchReport(data.report);
        if (action !== "fetch_only") {
          await refreshGraph();
        }
        await refreshCreatorData();
      }
    } finally {
      setResearchBusy(false);
    }
  };

  const handleAddSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSourceName.trim() || !newSourceTarget.trim()) return;
    const source: ResearchSourceConfig =
      newSourceKind === "youtube"
        ? {
            name: newSourceName.trim(),
            kind: "youtube",
            handle: newSourceTarget.trim().startsWith("@")
              ? newSourceTarget.trim()
              : `@${newSourceTarget.trim()}`,
            priority: 1,
            tags: ["competitor-coverage"],
          }
        : newSourceKind === "arxiv"
        ? {
            name: newSourceName.trim(),
            kind: "arxiv",
            categories: newSourceTarget
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
            fetch: 25,
            priority: 2,
          }
        : {
            name: newSourceName.trim(),
            kind: "rss",
            url: newSourceTarget.trim(),
            priority: 3,
          };

    setResearchBusy(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "add_source", source }),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: ResearchStatusData };
        if (data.status) setResearchStatus(data.status);
        setNewSourceName("");
        setNewSourceTarget("");
      }
    } finally {
      setResearchBusy(false);
    }
  };

  const handleRemoveSource = async (sourceName: string) => {
    setResearchBusy(true);
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_source", sourceName }),
      });
      if (res.ok) {
        const data = (await res.json()) as { status?: ResearchStatusData };
        if (data.status) setResearchStatus(data.status);
      }
    } finally {
      setResearchBusy(false);
    }
  };

  const handleSyncVault = async () => {
    setLoading(true);
    try {
      await syncVault({ enableAiEnrichment: false });
      await refreshCreatorData();
    } finally {
      setLoading(false);
    }
  };

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-full max-w-md flex-col border-r border-slate-800 bg-slate-950/96 text-slate-200 shadow-2xl">
      <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-wider text-sky-400">
            CortexOS · Phase 0 → Phase 1
          </span>
          <h2 className="mt-0.5 text-base font-semibold text-white">
            Creator Intelligence &amp; Vault Sync
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCreatorDrawerOpen(false)}
          aria-label="Close Creator OS drawer"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="ge-scrollbar flex-1 space-y-6 overflow-y-auto p-5 text-xs">
        {/* Vault Sync + ContextPack */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FolderSync className="h-4 w-4 text-sky-400" />
              <span className="font-semibold text-white">CortexVault Projection</span>
            </div>
            <button
              type="button"
              onClick={handleSyncVault}
              disabled={isSyncingVault}
              className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 font-medium text-white whitespace-nowrap shrink-0 hover:bg-sky-500 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isSyncingVault ? "animate-spin" : ""}`}
              />
              <span>{isSyncingVault ? "Syncing..." : "Sync Vault"}</span>
            </button>
          </div>

          <p className="mt-2 text-slate-400">
            Deterministic YAML + <code className="font-mono text-slate-300">[[wikilink]]</code>{" "}
            sync from <span className="font-mono text-slate-300">./CortexVault</span> into
            PGlite &amp; <span className="font-mono text-slate-300">.cortex/repo-brain.json</span>.
          </p>

          {lastSyncStats && (
            <div className="mt-3 border-t border-slate-800 pt-2.5 font-mono text-[11px] text-emerald-300">
              <span>{lastSyncStats.totalNotes} notes</span>
              <span aria-hidden="true"> · </span>
              <span>{lastSyncStats.embeddedNotes} indexed</span>
              <span aria-hidden="true"> · </span>
              <span>{lastSyncStats.skippedUnchanged} unchanged</span>
              <span aria-hidden="true"> · </span>
              <span>{lastSyncStats.edgesSynced} edges</span>
            </div>
          )}

          {vaultStatus && (
            <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-slate-400">
              <span>
                ContextPack:{" "}
                {vaultStatus.hasRepoBrain
                  ? `${vaultStatus.estimatedTokens} tokens (<=1500)`
                  : "Not exported yet"}
              </span>
              {vaultStatus.contextPack && (
                <button
                  type="button"
                  onClick={() => setShowContextPack((v) => !v)}
                  className="text-sky-400 hover:underline"
                >
                  {showContextPack ? "Hide Pack" : "Inspect Pack"}
                </button>
              )}
            </div>
          )}

          {showContextPack && vaultStatus?.contextPack && (
            <pre className="mt-2.5 max-h-44 overflow-y-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-950 p-2.5 font-mono text-[11px] leading-relaxed text-slate-300">
              {vaultStatus.contextPack}
            </pre>
          )}
        </section>

        {/* Vault Composition Counters */}
        {stats && (
          <section className="grid grid-cols-3 gap-2 font-mono text-[11px]">
            <div className="rounded-md border border-slate-800/90 bg-slate-900/50 p-2.5">
              <div className="text-slate-400">Vault Notes</div>
              <div className="mt-0.5 text-sm font-semibold text-white">
                {stats.counts.vaultNotes}
                <span className="text-slate-500"> / {stats.counts.totalNodes}</span>
              </div>
            </div>
            <div className="rounded-md border border-slate-800/90 bg-slate-900/50 p-2.5">
              <div className="text-slate-400">Concepts</div>
              <div className="mt-0.5 text-sm font-semibold text-indigo-300">
                {stats.counts.concepts}
              </div>
            </div>
            <div className="rounded-md border border-slate-800/90 bg-slate-900/50 p-2.5">
              <div className="text-slate-400">Active Edges</div>
              <div className="mt-0.5 text-sm font-semibold text-emerald-300">
                {stats.counts.edges}
              </div>
            </div>
          </section>
        )}

        {/* Phase 0.5: Research Agent & Inbox Pipeline */}
        <section className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Rss className="h-4 w-4 text-emerald-400" />
              <span className="font-semibold text-white">Research Agent &amp; Inbox</span>
            </div>
            <button
              type="button"
              onClick={() => setShowFeedsPanel((v) => !v)}
              className="font-mono text-[11px] text-sky-400 hover:underline"
            >
              {showFeedsPanel
                ? "Hide Feeds"
                : `Feeds (${researchStatus?.sources.length ?? 0})`}
            </button>
          </div>

          {researchStatus && (
            <div className="mt-2 flex items-center gap-2 font-mono text-[11px] text-slate-400">
              <Inbox className="h-3.5 w-3.5 text-slate-500" />
              <span>
                {researchStatus.pendingInboxFiles.length} pending in Inbox ·{" "}
                {researchStatus.seenCount} seen
              </span>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={researchBusy}
              onClick={() => handleResearchAction("fetch_only")}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-medium text-slate-200 whitespace-nowrap shrink-0 hover:border-slate-500 disabled:opacity-50"
            >
              <Rss className="h-3.5 w-3.5 text-emerald-400" />
              <span>Fetch Feeds</span>
            </button>
            <button
              type="button"
              disabled={researchBusy}
              onClick={() => handleResearchAction("run_pipeline")}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white whitespace-nowrap shrink-0 hover:bg-emerald-500 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${researchBusy ? "animate-spin" : ""}`}
              />
              <span>
                {researchBusy ? "Running..." : "Run Research + Librarian"}
              </span>
            </button>
            {researchStatus && researchStatus.pendingInboxFiles.length > 0 && (
              <button
                type="button"
                disabled={researchBusy}
                onClick={() => handleResearchAction("process_inbox")}
                className="inline-flex items-center gap-1 rounded-md border border-sky-500/50 bg-sky-500/15 px-2.5 py-1.5 font-medium text-sky-200 whitespace-nowrap shrink-0 hover:bg-sky-500/25 disabled:opacity-50"
              >
                <span>Process Inbox ({researchStatus.pendingInboxFiles.length})</span>
              </button>
            )}
          </div>

          {researchStatus && researchStatus.pendingInboxFiles.length > 0 && (
            <div className="mt-2.5 space-y-1 border-t border-slate-800 pt-2">
              {researchStatus.pendingInboxFiles.slice(0, 4).map((f) => (
                <div
                  key={f}
                  className="truncate font-mono text-[11px] text-amber-300"
                >
                  Inbox/{f}
                </div>
              ))}
            </div>
          )}

          {lastResearchReport && (
            <div className="mt-2.5 border-t border-slate-800 pt-2 font-mono text-[11px] text-slate-300">
              <div>
                Dropped: {lastResearchReport.dropped.length} · Processed:{" "}
                {lastResearchReport.processedInbox?.length ?? 0} · Summaries:{" "}
                {lastResearchReport.createdSummaries?.length ?? 0}
              </div>
              {lastResearchReport.errors.length > 0 && (
                <div className="mt-1 text-rose-300">
                  {lastResearchReport.errors[0]}
                </div>
              )}
            </div>
          )}

          {showFeedsPanel && researchStatus && (
            <div className="mt-3 space-y-2.5 border-t border-slate-800 pt-3">
              <div className="space-y-1.5">
                {researchStatus.sources.map((src) => (
                  <div
                    key={src.name}
                    className="flex items-center justify-between gap-2 rounded border border-slate-800/80 bg-slate-950/70 px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-200">
                        {src.name}
                      </div>
                      <div className="truncate font-mono text-[10px] text-slate-400">
                        {src.kind} ·{" "}
                        {src.handle ||
                          src.url ||
                          src.categories?.join(", ") ||
                          ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={researchBusy}
                      onClick={() => handleRemoveSource(src.name)}
                      aria-label={`Remove ${src.name}`}
                      className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-300"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddSource} className="space-y-2 pt-1">
                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    type="text"
                    placeholder="Source name"
                    value={newSourceName}
                    onChange={(e) => setNewSourceName(e.target.value)}
                    className="col-span-2 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                  <select
                    value={newSourceKind}
                    onChange={(e) =>
                      setNewSourceKind(
                        e.target.value as "rss" | "youtube" | "arxiv"
                      )
                    }
                    className="rounded border border-slate-800 bg-slate-950 px-1.5 py-1 text-[11px] text-slate-200 focus:outline-none"
                  >
                    <option value="rss">RSS</option>
                    <option value="youtube">YouTube</option>
                    <option value="arxiv">arXiv</option>
                  </select>
                </div>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    placeholder={
                      newSourceKind === "youtube"
                        ? "@ChannelHandle"
                        : newSourceKind === "arxiv"
                        ? "cs.AI, cs.CL"
                        : "https://.../feed.xml"
                    }
                    value={newSourceTarget}
                    onChange={(e) => setNewSourceTarget(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-white placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={researchBusy}
                    className="inline-flex items-center gap-1 rounded bg-slate-800 px-2.5 py-1 font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add</span>
                  </button>
                </div>
              </form>
            </div>
          )}
        </section>

        {/* Widget 1: Trend-Gap Detector */}
        <section className="border-t border-slate-800/80 pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5 font-semibold text-white">
              <Flame className="h-3.5 w-3.5 text-amber-400" />
              <span>Trend Gaps (14d Sources, No Armory Idea)</span>
            </div>
            {loading && <span className="font-mono text-[10px] text-slate-500">Refreshing</span>}
          </div>

          {!stats || stats.trendGaps.length === 0 ? (
            <p className="text-slate-400">
              No uncovered trending concepts detected. Sync CortexVault or ingest new sources.
            </p>
          ) : (
            <div className="space-y-2">
              {stats.trendGaps.map((gap) => (
                <button
                  key={gap.conceptId}
                  type="button"
                  onClick={() => {
                    focusNodeEgo(gap.conceptId);
                    onSelectNode(gap.conceptId);
                  }}
                  className="flex w-full flex-col gap-1 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-amber-500/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white">{gap.conceptTitle}</span>
                    <span className="font-mono text-[11px] text-amber-300">
                      {gap.recentSourceCount} source{gap.recentSourceCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="line-clamp-1 font-mono text-[11px] text-slate-400">
                    {gap.supportingSources.join(" · ")}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Widget 2: Armory Creator Pipeline */}
        <section className="border-t border-slate-800/80 pt-4">
          <div className="mb-2.5 flex items-center gap-1.5 font-semibold text-white">
            <Lightbulb className="h-3.5 w-3.5 text-pink-400" />
            <span>Creator Pipeline (Armory)</span>
          </div>

          {!stats || stats.pipeline.length === 0 ? (
            <p className="text-slate-400">
              No Armory ideas indexed yet. Sync CortexVault to import Armory notes.
            </p>
          ) : (
            <div className="space-y-2">
              {stats.pipeline.map((card) => (
                <button
                  key={card.ideaId}
                  type="button"
                  onClick={() => {
                    focusNodeEgo(card.ideaId);
                    onSelectNode(card.ideaId);
                  }}
                  className="flex w-full flex-col gap-1 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-pink-500/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white">{card.title}</span>
                    <span className="font-mono text-[10px] uppercase text-pink-300">
                      {card.status}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-[11px] text-slate-400">{card.hook}</p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Widget 3: Competitor Coverage Matrix */}
        <section className="border-t border-slate-800/80 pt-4">
          <div className="mb-2.5 flex items-center gap-1.5 font-semibold text-white">
            <Tv className="h-3.5 w-3.5 text-emerald-400" />
            <span>Competitor Coverage Matrix</span>
          </div>

          {!stats || stats.competitors.length === 0 ? (
            <p className="text-slate-400">
              No tracked competitor channels yet. Tag channel entities with{" "}
              <code className="font-mono text-slate-300">competitor</code>.
            </p>
          ) : (
            <div className="space-y-2">
              {stats.competitors.map((comp) => (
                <button
                  key={comp.channelId}
                  type="button"
                  onClick={() => {
                    focusNodeEgo(comp.channelId);
                    onSelectNode(comp.channelId);
                  }}
                  className="flex w-full flex-col gap-1 rounded-md border border-slate-800 bg-slate-900/60 p-3 text-left transition-colors hover:border-emerald-500/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white">{comp.channelTitle}</span>
                    <span className="font-mono text-[11px] text-emerald-300">
                      {comp.summariesLogged} logged
                    </span>
                  </div>
                  {comp.topicsCovered.length > 0 && (
                    <div className="font-mono text-[11px] text-slate-400">
                      {comp.topicsCovered.join(" · ")}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Widget 4: Filtered 2-Hop Ego-Graph Slice */}
        {egoSlice && egoSlice.nodes.length > 0 && (
          <section className="border-t border-slate-800/80 pt-4">
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-white">
                <Compass className="h-3.5 w-3.5 text-indigo-400" />
                <span>2-Hop Ego Slice ({egoSlice.nodes.length} nodes)</span>
              </div>
              {egoSlice.centerId && (
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectNode(egoSlice.centerId!);
                      setViewMode("2d");
                    }}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-emerald-400 hover:underline"
                  >
                    <Share2 className="h-3 w-3" />
                    <span>XYFlow</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => focusNodeEgo(egoSlice.centerId!)}
                    className="inline-flex items-center gap-1 font-mono text-[11px] text-sky-400 hover:underline"
                  >
                    <span>Isolate 3D</span>
                    <ArrowUpRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <div className="space-y-1">
              {egoSlice.nodes.slice(0, 10).map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onSelectNode(n.id)}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-slate-900"
                >
                  <span className="truncate text-slate-200">{n.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-slate-400">
                    {n.kind} · hop {n.hopDistance}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
