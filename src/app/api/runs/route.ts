import { NextResponse } from "next/server"
import { getStore, listRuns } from "@/lib/backend-store"

export async function GET() {
  const runs = listRuns()
  return NextResponse.json({
    ok: true,
    runs,
    user: getStore().user,
    pendingActions: getStore().pendingActions,
  })
}
