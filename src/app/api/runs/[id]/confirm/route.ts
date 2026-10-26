import { NextResponse } from "next/server"
import { confirmPendingUpdate } from "@/lib/backend-store"

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params
  const body = await request.json().catch(() => ({}))
  const pendingId = String(body.pendingId ?? body.id ?? "")
  const confirm = body.confirm !== false

  if (!pendingId) {
    return NextResponse.json({ ok: false, error: "Missing pendingAction id" }, { status: 400 })
  }

  const result = confirmPendingUpdate(pendingId, confirm)
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
