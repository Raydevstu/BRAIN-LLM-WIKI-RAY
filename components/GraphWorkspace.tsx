"use client";

import { GraphProvider, GraphCanvas } from "@/packages/graph-engine";

export default function GraphWorkspace() {
  return (
    <GraphProvider
      apiBasePath="/api/graph"
      initialLayout="orbit"
      initialTheme="obsidian"
    >
      <GraphCanvas title="Cortex Graph Engine" />
    </GraphProvider>
  );
}
