import { NextResponse } from "next/server"
import { eligibleTasks } from "@/lib/workflow"
import {
  confirmPendingUpdate,
  getRunById,
  getStatusSummary,
  getStore,
  listRuns,
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
  const body = await request.json().catch(() => ({}))
  const requestType = body?.request?.type ?? body?.type ?? "IntentRequest"
  const intentName = body?.request?.intent?.name ?? body?.intent?.name ?? requestType
  const slots = body?.request?.intent?.slots ?? body?.intent?.slots ?? {}
  const store = getStore()
  const run = store.runs[0] ?? null

  if (!run) {
    return NextResponse.json({ ok: false, error: "No production runs are available." })
  }

  if (requestType === "LaunchRequest" || intentName === "LaunchRequest") {
    return NextResponse.json({
      ok: true,
      speech: "Welcome to CUE. Ask for status, ready tasks, waiting tasks, or update a task.",
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
      return NextResponse.json({ ok: true, speech: `There are no ready tasks in ${run.runId} right now.` })
    }
    return NextResponse.json({
      ok: true,
      speech: `Ready tasks for ${run.runId}: ${ready.map((task) => task.name).join(", ")}.`,
    })
  }

  if (intentName === "GetWaitingTasks") {
    const waiting = run.tasks.filter((task) => task.state === "WAITING")
    if (!waiting.length) {
      return NextResponse.json({ ok: true, speech: `Nothing is waiting in ${run.runId}.` })
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
      return NextResponse.json({ ok: false, error: "I could not find that task in the current run." }, { status: 400 })
    }

    const normalizedState = stateName.toLowerCase()
    const nextState =
      normalizedState.includes("ready")
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
      return NextResponse.json({ ok: false, error: result.error }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      speech: `I proposed the update for ${task.name}. Please say confirm to apply it or cancel to keep the current record.`,
      pendingAction: result.pendingAction,
    })
  }

  if (intentName === "ConfirmUpdate") {
    const pending = store.pendingActions.find((item) => item.status === "PENDING")
    if (!pending) {
      return NextResponse.json({ ok: true, speech: "There is no pending update to confirm." })
    }
    const result = confirmPendingUpdate(pending.id, true)
    return NextResponse.json({
      ok: result.ok,
      speech: result.ok ? "Confirmed. The task state has been updated." : result.error,
    })
  }

  if (intentName === "CancelUpdate") {
    const pending = store.pendingActions.find((item) => item.status === "PENDING")
    if (!pending) {
      return NextResponse.json({ ok: true, speech: "There is no pending update to cancel." })
    }
    const result = confirmPendingUpdate(pending.id, false)
    return NextResponse.json({
      ok: result.ok,
      speech: result.ok ? "Cancelled. The production record was left unchanged." : result.error,
    })
  }

  return NextResponse.json({
    ok: true,
    speech: "I can help with production status, ready tasks, waiting tasks, and task updates.",
  })
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "cue-alexa-mvp",
    intents: [
      "GetStatus",
      "GetReadyTasks",
      "GetWaitingTasks",
      "ProposeTaskUpdate",
      "ConfirmUpdate",
      "CancelUpdate",
    ],
  })
}
