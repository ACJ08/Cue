import { NextResponse } from "next/server"
import { confirmPendingUpdate, getStore } from "@/lib/backend-store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const pendingId = body.pendingId ?? body.id ?? null
  const confirm = body.confirm ?? true

  if (!pendingId) {
    const pending = getStore().pendingActions.find(
      (item) => item.productionRun === id && item.status === "PENDING",
    )
    if (!pending) {
      return NextResponse.json({ ok: false, error: "No pending update exists for this run." }, { status: 400 })
    }
    const result = confirmPendingUpdate(pending.id, confirm)
    return result.ok
      ? NextResponse.json({ ok: true, confirmed: confirm })
      : NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  const result = confirmPendingUpdate(pendingId, confirm)
  return result.ok
    ? NextResponse.json({ ok: true, confirmed: confirm })
    : NextResponse.json({ ok: false, error: result.error }, { status: 400 })
}
