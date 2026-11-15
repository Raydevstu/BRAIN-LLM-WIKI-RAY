import { NextRequest } from "next/server";
import { createGraphApiHandlers } from "@/packages/graph-engine/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createGraphApiHandlers();

export async function GET() {
  return handlers.getVaultBrainStatus();
}

export async function POST(req: NextRequest) {
  return handlers.syncVault(req);
}
