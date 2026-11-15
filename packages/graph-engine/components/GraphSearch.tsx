"use client";

import React, { useEffect, useRef, useState } from "react";
import { Search, Sparkles, X } from "lucide-react";
import type { GraphSearchResult } from "../types";
import { useGraph } from "../hooks/useGraph";

export function GraphSearch() {
  const { searchQuery, setSearchQuery, searchServer, setSelectedNodeId } = useGraph();
  const [serverHits, setServerHits] = useState<GraphSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      searchServer(q, 8)
        .then((hits) => {
          if (active) setServerHits(hits);
        })
        .catch(() => {
          if (active) setServerHits([]);
        });
    }, 220);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [searchQuery, searchServer]);

  return (
    <div ref={containerRef} className="relative w-64 sm:w-80">
      <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900/95 px-3 py-1.5 text-xs text-slate-100">
        <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <input
          type="text"
          value={searchQuery}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            const val = e.target.value;
            setSearchQuery(val);
            if (val.trim().length < 2) {
              setServerHits([]);
            }
            setOpen(true);
          }}
          placeholder="Filter or hybrid-search graph..."
          aria-label="Search knowledge graph"
          className="w-full bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setServerHits([]);
            }}
            aria-label="Clear search"
            className="text-slate-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {open && serverHits.length > 0 && (
        <div className="ge-scrollbar absolute left-0 right-0 top-full z-50 mt-1.5 max-h-80 overflow-y-auto rounded-lg border border-slate-700/90 bg-slate-950/98 p-1.5 shadow-2xl">
          <div className="mb-1 flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium text-slate-400">
            <Sparkles className="h-3 w-3 text-sky-400" />
            <span>Hybrid FTS + Vector Matches</span>
          </div>
          {serverHits.map((hit) => (
            <button
              key={`${hit.nodeId}-${hit.title}`}
              type="button"
              onClick={() => {
                setSelectedNodeId(hit.nodeId);
                setOpen(false);
              }}
              className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-slate-800/90"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-slate-100">
                  {hit.title}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-sky-400">
                  {hit.kind} · RRF {hit.rrfScore.toFixed(3)}
                </span>
              </div>
              <p className="line-clamp-1 text-[11px] text-slate-400">{hit.snippet}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
