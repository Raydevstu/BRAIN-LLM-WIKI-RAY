import { createGraphApiHandlers } from "@/packages/graph-engine/server";

const handlers = createGraphApiHandlers();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handlers.updateNode(req, id);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return handlers.deleteNode(req, id);
}
