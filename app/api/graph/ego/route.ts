import { NextRequest } from "next/server";
import { createGraphApiHandlers } from "@/packages/graph-engine/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createGraphApiHandlers();

export async function GET(req: NextRequest) {
  return handlers.getEgoGraph(req);
}
