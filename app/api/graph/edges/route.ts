import { createGraphApiHandlers } from "@/packages/graph-engine/server";

const handlers = createGraphApiHandlers();

export async function POST(req: Request) {
  return handlers.linkNodes(req);
}
