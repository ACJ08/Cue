import { NextResponse } from "next/server"
import { createRun, getStore, listRuns } from "@/lib/backend-store"

export async function GET() {
  const runs = listRuns()
  return NextResponse.json({
    ok: true,
    runs,
    user: getStore().user,
    pendingActions: getStore().pendingActions,
  })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const productId = String(body.productId ?? body.product ?? "")
  const quantity = Number(body.quantity) || 12
  const runType: "customer-order" | "planned-production" =
    body.runType === "customer-order" ? "customer-order" : "planned-production"
  const owner = body.owner ? String(body.owner) : undefined

  if (!productId) {
    return NextResponse.json(
      { ok: false, error: "Missing required field 'productId'" },
      { status: 400 },
    )
  }

  const run = createRun(productId, { quantity, runType, owner })
  if (!run) {
    return NextResponse.json(
      { ok: false, error: `Product '${productId}' not found` },
      { status: 404 },
    )
  }

  return NextResponse.json({ ok: true, run }, { status: 201 })
}
