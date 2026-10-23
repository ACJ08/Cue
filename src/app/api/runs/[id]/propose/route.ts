import { NextResponse } from "next/server"
import { getRunById, getStatusSummary } from "@/lib/backend-store"

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
