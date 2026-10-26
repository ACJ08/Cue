import { NextResponse } from "next/server"
import { getRunById, getStatusSummary, proposeTaskUpdate } from "@/lib/backend-store"
import type { TaskState } from "@/lib/demo-types"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const run = getRunById(id)
  if (!run) {
    return NextResponse.json({ ok: false, error: "Run not found" }, { status: 404 })
  }
  return NextResponse.json({ ok: true, status: getStatusSummary(run) })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const taskKey = String(body.taskKey ?? body.task ?? "")
  const nextState = String(body.nextState ?? body.state ?? "IN_PROGRESS") as TaskState
  const reason = String(body.reason ?? "Requested through API.")
  const actionType = String(body.actionType ?? "transition") as "transition" | "correction" | "inspection"

  const result = proposeTaskUpdate(id, taskKey, nextState, reason, actionType)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, pendingAction: result.pendingAction })
}
