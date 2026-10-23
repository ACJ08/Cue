import { NextResponse } from "next/server"
import {
  confirmPendingUpdate,
  getRunById,
  getStatusSummary,
  listRuns,
  proposeTaskUpdate,
} from "@/lib/backend-store"
import { eligibleTasks } from "@/lib/workflow"

export async function GET() {
  return NextResponse.json({ ok: true, service: "cue-alexa-mvp", intents: ["GetStatus", "GetReadyTasks", "GetWaitingTasks", "ProposeTaskUpdate", "ConfirmUpdate", "CancelUpdate"] })
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const requestType = body?.request?.type ?? body?.type
  const intentName = body?.request?.intent?.name ?? body?.intent?.name ?? requestType
  const slots = body?.request?.intent?.slots ?? body?.intent?.slots ?? {}

  const run = listRuns()[0] ?? null
  if (!run) {
    return NextResponse.json({ ok: false, error: "No production runs are available." })
  }

  if (requestType === "LaunchRequest" || intentName === "LaunchRequest") {
    return NextResponse.json({
      ok: true,
      speech: "Welcome to CUE. Ask for status, ready tasks, waiting tasks, or to update a task.",
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
    const taskSlot = slots.task?.value ?? ""
    const stateSlot = slots.state?.value ?? "in progress"
    const targetRun = getRunById(slots.run?.value ?? run.id) ?? run
    const task = targetRun.tasks.find((item) => {
      const normalized = item.name.toLowerCase()
      return normalized.includes(taskSlot.toLowerCase()) || taskSlot.toLowerCase().includes(normalized)
    })
    if (!task) {
      return NextResponse.json({ ok: false, error: `I could not match task ${taskSlot || "you requested"}.` })
    }

    const normalizedState =
      stateSlot.toLowerCase().includes("ready") ? "READY" :
      stateSlot.toLowerCase().includes("wait") ? "WAITING" :
      stateSlot.toLowerCase().includes("block") ? "BLOCKED" :
      stateSlot.toLowerCase().includes("inspect") ? "NEEDS_INSPECTION" :
      stateSlot.toLowerCase().includes("complete") ? "COMPLETED" :
      "IN_PROGRESS"

    const result = proposeTaskUpdate(
      targetRun.id,
      task.taskKey,
      normalizedState as ProductionRun["tasks"][number]["state"],
      "Requested through Alexa voice assistant.",
      task.physicalCheckRequired ? "inspection" : "transition",
    )
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error })
    }
    return NextResponse.json({
      ok: true,
      speech: `I proposed the update for ${task.name}. Please say confirm or cancel.`,
      pendingAction: result.pendingAction,
    })
  }

  if (intentName === "ConfirmUpdate") {
    const pending = listRuns()[0]?.id
      ? (() => {
          const store = getRunById(run.id) ? "" : ""
          return undefined
        })()
      : null
    const store = getRunById(run.id) ? undefined : undefined
    return NextResponse.json({ ok: true, speech: "Confirmation is available from the queue after a proposal is created." })
  }

  return NextResponse.json({ ok: true, speech: "I can help with your production status, ready tasks, waiting tasks, or updating a task." })
}
