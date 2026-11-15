"use client";

import dynamic from "next/dynamic";

const GraphWorkspace = dynamic(() => import("@/components/GraphWorkspace"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-[#050814]">
      <div className="rounded-lg border border-slate-800 bg-slate-950/95 px-5 py-3 text-xs font-medium text-slate-300">
        Initializing Knowledge Graph &amp; PostgreSQL Vector Index...
      </div>
    </div>
  ),
});

export default function HomePage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-[#050814]">
      <GraphWorkspace />
    </main>
  );
}
