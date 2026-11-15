import { createGraphApiHandlers } from "@/packages/graph-engine/server";

const handlers = createGraphApiHandlers();

export async function GET(req: Request) {
  return handlers.search(req);
}
