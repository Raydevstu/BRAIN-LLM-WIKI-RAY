"use client";

import { useContext } from "react";
import { GraphContext, type GraphContextValue } from "../providers/GraphProvider";

export function useGraph(): GraphContextValue {
  const ctx = useContext(GraphContext);
  if (!ctx) {
    throw new Error("useGraph must be used inside a <GraphProvider>.");
  }
  return ctx;
}
