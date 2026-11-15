import { createGraphApiHandlers } from "@/packages/graph-engine/server";

const handlers = createGraphApiHandlers();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const depth = Number(new URL(req.url).searchParams.get("depth") || "2");
  return handlers.getGraph(id, depth);
}
