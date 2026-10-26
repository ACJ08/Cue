export const dynamic = "force-static"

import { buildAlexaResponse } from "@/lib/alexa"
import type { PendingAction, ProductionRun } from "@/lib/demo-types"
import { createInitialDemoState } from "@/lib/demo-data"

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      command?: string
      text?: string
      runId?: string
      run?: ProductionRun
      runs?: ProductionRun[]
      pendingAction?: PendingAction | null
      deviceId?: string
    }

    const command =
      typeof body.command === "string" ? body.command : body.text ?? ""

    let runs = body.runs
    if (!runs || !runs.length) {
      const initial = createInitialDemoState()
      runs = initial.runs
    }

    let run = body.run
    if (!run && body.runId) {
      run = runs.find(
        (r) =>
          r.id === body.runId ||
          r.runId.toLowerCase() === body.runId?.toLowerCase(),
      )
    }
    if (!run) {
      run = runs[0]
    }

    const result = buildAlexaResponse(command, {
      run,
      runs,
      pendingAction: body.pendingAction ?? null,
    })

    return Response.json({
      ok: true,
      intent: result.intent,
      normalized: result.normalized,
      response: result.response,
      action: result.action,
      runId: result.runId ?? run?.id,
      runCode: result.run ?? run?.runId,
      taskKey: result.taskKey,
      cardTitle: result.cardTitle,
      cardText: result.cardText,
      deviceId: body.deviceId ?? "alexa-client",
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
    service: "CUE Alexa Voice Assistant Backend Service",
    status: "active",
    intents: [
      "status",
      "next_task",
      "waiting",
      "inspection",
      "confirm_update",
      "cancel_update",
      "blocked",
      "switch_run",
      "transition_task",
      "help",
      "greeting",
      "unknown",
    ],
    sampleCommands: [
      "Alexa, what can I do next?",
      "Alexa, what is waiting?",
      "Alexa, what is the status of DEMO-HIO?",
      "Alexa, why is cook-main blocked?",
      "Alexa, mark the inspection complete.",
      "Alexa, switch to DEMO-T4X.",
      "Alexa, start cook-main.",
    ],
  })
}
