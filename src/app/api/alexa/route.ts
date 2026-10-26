import { NextResponse } from "next/server"
import { buildAlexaResponse } from "@/lib/alexa"
import type { PendingAction, ProductionRun } from "@/lib/demo-types"
import { createInitialDemoState } from "@/lib/demo-data"
import { eligibleTasks } from "@/lib/workflow"
import {
  confirmPendingUpdate,
  getRunById,
  getStatusSummary,
  getStore,
  proposeTaskUpdate,
} from "@/lib/backend-store"

const findTaskByName = (runId: string, taskName: string) => {
  const run = getRunById(runId)
  if (!run) return null
  const normalized = taskName.trim().toLowerCase()
  return (
    run.tasks.find((task) => task.name.toLowerCase() === normalized) ??
    run.tasks.find((task) => task.name.toLowerCase().includes(normalized)) ??
    null
  )
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}))

    // 1. Check if this is an Amazon Alexa Custom Skill request format
    const isAlexaSkillRequest = Boolean(
      body?.request?.type ||
      body?.request?.intent ||
      (body?.intent?.name && !body?.command),
    )

    if (isAlexaSkillRequest) {
      const requestType = body?.request?.type ?? body?.type ?? "IntentRequest"
      const intentName =
        body?.request?.intent?.name ?? body?.intent?.name ?? requestType
      const slots = body?.request?.intent?.slots ?? body?.intent?.slots ?? {}
      const store = getStore()
      const run = store.runs[0] ?? null

      if (!run) {
        return NextResponse.json({
          ok: false,
          error: "No production runs are available.",
        })
      }

      if (requestType === "LaunchRequest" || intentName === "LaunchRequest") {
        return NextResponse.json({
          ok: true,
          speech:
            "Welcome to CUE. Ask for status, ready tasks, waiting tasks, or update a task.",
        })
      }

      if (intentName === "GetStatus") {
        const summary = getStatusSummary(run)
        return NextResponse.json({
          ok: true,
          speech: `Your active run ${summary.runId} is ${summary.completionPercent}% complete. ${summary.waitingCount} tasks are waiting, ${summary.blockedCount} are blocked, and ${summary.inspectionCount} need inspection.`,
        })
      }

      if (intentName === "GetReadyTasks") {
        const ready = eligibleTasks(run)
        if (!ready.length) {
          return NextResponse.json({
            ok: true,
            speech: `There are no ready tasks in ${run.runId} right now.`,
          })
        }
        return NextResponse.json({
          ok: true,
          speech: `Ready tasks for ${run.runId}: ${ready.map((task) => task.name).join(", ")}.`,
        })
      }

      if (intentName === "GetWaitingTasks") {
        const waiting = run.tasks.filter((task) => task.state === "WAITING")
        if (!waiting.length) {
          return NextResponse.json({
            ok: true,
            speech: `Nothing is waiting in ${run.runId}.`,
          })
        }
        return NextResponse.json({
          ok: true,
          speech: `Waiting tasks: ${waiting.map((task) => task.name).join(", ")}.`,
        })
      }

      if (intentName === "ProposeTaskUpdate") {
        const taskName = String(slots.task?.value ?? "").trim()
        const stateName = String(slots.state?.value ?? "in progress").trim()
        const task = findTaskByName(run.id, taskName) ?? run.tasks[0]
        if (!task) {
          return NextResponse.json(
            { ok: false, error: "I could not find that task in the current run." },
            { status: 400 },
          )
        }

        const normalizedState = stateName.toLowerCase()
        const nextState = normalizedState.includes("ready")
          ? "READY"
          : normalizedState.includes("wait")
            ? "WAITING"
            : normalizedState.includes("block")
              ? "BLOCKED"
              : normalizedState.includes("inspect")
                ? "NEEDS_INSPECTION"
                : normalizedState.includes("complete")
                  ? "COMPLETED"
                  : "IN_PROGRESS"

        const result = proposeTaskUpdate(
          run.id,
          task.taskKey,
          nextState as ProductionRun["tasks"][number]["state"],
          "Requested through Alexa voice assistant.",
          task.physicalCheckRequired ? "inspection" : "transition",
        )
        if (!result.ok) {
          return NextResponse.json(
            { ok: false, error: result.error },
            { status: 400 },
          )
        }

        return NextResponse.json({
          ok: true,
          speech: `I proposed the update for ${task.name}. Please say confirm to apply it or cancel to keep the current record.`,
          pendingAction: result.pendingAction,
        })
      }

      if (intentName === "ConfirmUpdate") {
        const pending = store.pendingActions.find(
          (item) => item.status === "PENDING",
        )
        if (!pending) {
          return NextResponse.json({
            ok: true,
            speech: "There is no pending update to confirm.",
          })
        }
        const result = confirmPendingUpdate(pending.id, true)
        return NextResponse.json({
          ok: result.ok,
          speech: result.ok
            ? "Confirmed. The task state has been updated."
            : result.error,
        })
      }

      if (intentName === "CancelUpdate") {
        const pending = store.pendingActions.find(
          (item) => item.status === "PENDING",
        )
        if (!pending) {
          return NextResponse.json({
            ok: true,
            speech: "There is no pending update to cancel.",
          })
        }
        const result = confirmPendingUpdate(pending.id, false)
        return NextResponse.json({
          ok: result.ok,
          speech: result.ok
            ? "Cancelled. The production record was left unchanged."
            : result.error,
        })
      }

      return NextResponse.json({
        ok: true,
        speech:
          "I can help with production status, ready tasks, waiting tasks, and task updates.",
      })
    }

    // 2. Otherwise handle as CUE web client voice command
    const command =
      typeof body.command === "string" ? body.command : body.text ?? ""

    let runs = body.runs as ProductionRun[] | undefined
    if (!runs || !runs.length) {
      try {
        const store = getStore()
        if (store?.runs?.length) runs = store.runs
      } catch {
        // Fall back to initial demo state
      }
      if (!runs || !runs.length) {
        const initial = createInitialDemoState()
        runs = initial.runs
      }
    }

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

    return NextResponse.json({
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
    return NextResponse.json(
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
  return NextResponse.json({
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
      "GetStatus",
      "GetReadyTasks",
      "GetWaitingTasks",
      "ProposeTaskUpdate",
      "ConfirmUpdate",
      "CancelUpdate",
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
