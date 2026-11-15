import { createGraphApiHandlers } from "@/packages/graph-engine/server";

const handlers = createGraphApiHandlers();

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handlers.askNodeContext(req, id);
}
