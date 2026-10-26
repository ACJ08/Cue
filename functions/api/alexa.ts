import { buildAlexaResponse } from "@/lib/alexa"
import { createInitialDemoState } from "@/lib/demo-data"
import type { ProductionRun, PendingAction } from "@/lib/demo-types"

export async function onRequestPost(context: { request: Request }) {
  try {
    const body = (await context.request.json().catch(() => ({}))) as {
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

    const initial = createInitialDemoState()
    const runs: ProductionRun[] =
      body.runs && body.runs.length ? body.runs : initial.runs

    let run: ProductionRun | undefined = body.run
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

    return new Response(
      JSON.stringify({
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
        deviceId: body.deviceId ?? "alexa-cloudflare-pages",
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
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
      }),
      {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      },
    )
  }
}

export async function onRequestGet() {
  return new Response(
    JSON.stringify({
      ok: true,
      service: "CUE Alexa Voice Assistant Cloudflare Pages Service",
      status: "active",
      intents: [
        "status",
        "next_task",
        "waiting",
        "inspection",
        "confirm_update",
        "cancel_update",
        "blocked",
        "help",
        "unknown",
      ],
    }),
    {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    },
  )
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
