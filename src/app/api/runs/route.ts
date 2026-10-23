import { NextResponse } from "next/server"
import { getStore, listRuns } from "@/lib/backend-store"

export async function GET() {
  const runs = listRuns()
  return NextResponse.json({
    ok: true,
    runs: runs.map((run) => ({
      id: run.id,
      runId: run.runId,
      product: typeof run.product === "object" ? run.product.name : run.product,
      status: run.status,
      version: run.version,
    })),
    user: getStore().user,
    pendingActions: getStore().pendingActions,
  })
}
