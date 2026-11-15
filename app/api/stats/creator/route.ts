import { createGraphApiHandlers } from "@/packages/graph-engine/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createGraphApiHandlers();

export async function GET() {
  return handlers.getCreatorStats();
}
