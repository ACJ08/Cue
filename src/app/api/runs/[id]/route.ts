import { NextResponse } from "next/server"
import { getStore, listRuns } from "@/lib/backend-store"

export async function GET() {
  const runs = listRuns()
  return NextResponse.json({
    runs,
    user: getStore().user,
    pendingActions: getStore().pendingActions,
  })
}
