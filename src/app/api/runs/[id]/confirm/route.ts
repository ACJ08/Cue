import { NextResponse } from "next/server"
import { proposeTaskUpdate } from "@/lib/backend-store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const taskKey = body.taskKey ?? body.task ?? ""
  const nextState = body.nextState ?? body.state ?? "IN_PROGRESS"
  const reason = body.reason ?? "Requested through API."
  const actionType = body.actionType ?? "transition"

  const result = proposeTaskUpdate(id, taskKey, nextState, reason, actionType)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true, pendingAction: result.pendingAction })
}
