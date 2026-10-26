import { NextResponse } from "next/server"
import { getStore } from "@/lib/backend-store"

export async function GET() {
  return NextResponse.json({ ok: true, service: "cue-backend-mvp" })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const run = getStore().runs[0] ?? null
  return NextResponse.json({
    ok: true,
    run,
    message: "The CUE backend is live. Use the Alexa route or task API endpoints to propose and confirm workflow updates.",
    body,
  })
}
