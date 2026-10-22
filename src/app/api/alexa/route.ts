import { buildAlexaResponse } from "@/lib/alexa"

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      command?: string
      text?: string
      runId?: string
      deviceId?: string
    }

    const command = typeof body.command === "string" ? body.command : body.text ?? ""

    const result = buildAlexaResponse(command)

    return Response.json({
      ok: true,
      intent: result.intent,
      normalized: result.normalized,
      response: result.response,
      runId: body.runId,
      deviceId: body.deviceId,
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        intent: "unknown",
        response:
          error instanceof Error
            ? error.message
            : "Alexa could not process that request.",
        error:
          error instanceof Error
            ? error.message
            : "Alexa command could not be processed.",
      },
      { status: 400 },
    )
  }
}

export async function GET() {
  return Response.json({
    ok: true,
    message: "Alexa mock command API is available.",
    intents: ["status", "next_task", "confirm_update", "inspection", "unknown"],
  })
}
