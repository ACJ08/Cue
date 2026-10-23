import { NextResponse } from "next/server"
import { eligibleTasks, unmetPrerequisites } from "@/lib/workflow"
import {
  confirmPendingUpdate,
  getRunById,
  getStatusSummary,
  proposeTaskUpdate,
} from "@/lib/backend-store"

export function mapTaskNameToKey(taskName: string, runId: string) {
  const run = getRunById(runId)
  if (!run) return null
  const normalized = taskName.toLowerCase().trim()
  const match = run.tasks.find((task) =>
    task.name.toLowerCase().includes(normalized) ||
    normalized.includes(task.name.toLowerCase()),
  )
  return match ?? null
}

export function buildAlexaSpeech(payload: any) {
  const request = payload?.request ?? payload
  const intentName = request?.intent?.name ?? request?.type
  const slots = request?.intent?.slots ?? {}
  const firstRun = getRunById("run-pistachio") ?? getRunById("run-cheesecake") ?? null

  if (!firstRun) {
    return "There are no production runs available right now."
  }

  if (intentName === "GetStatus") {
    const summary = getStatusSummary(firstRun)
    return `Your active run ${summary.runId} is ${summary.completionPercent}% complete. ${summary.waitingCount} tasks are waiting, ${summary.blockedCount} are blocked, and ${summary.inspectionCount} need inspection.`
  }

  if (intentName === "GetReadyTasks") {
    const ready = eligibleTasks(firstRun)
    if (!ready.length) return `There are no ready tasks in ${firstRun.runId} right now.`
    return `Ready tasks for ${firstRun.runId}: ${ready.map((task) => task.name).join(", ")}.`
  }

  if (intentName === "GetWaitingTasks") {
    const waiting = firstRun.tasks.filter((task) => task.state === "WAITING")
    if (!waiting.length) return `Nothing is waiting in ${firstRun.runId}.`
    return `Waiting tasks: ${waiting.map((task) => task.name).join(", ")}.`
  }

  if (intentName === "ProposeTaskUpdate") {
    const taskSlot = slots.task?.value ?? ""
    const stateSlot = slots.state?.value ?? ""
    const runSlot = slots.run?.value ?? firstRun.id
    const targetRun = getRunById(runSlot) ?? firstRun
    const task = mapTaskNameToKey(taskSlot, targetRun.id)
    if (!task) {
      return `I could not match the task ${taskSlot || "you mentioned"}. Please say a task from the current production run.`
    }
    const requestedState =
      stateSlot === "ready"
        ? "READY"
        : stateSlot === "waiting"
          ? "WAITING"
          : stateSlot === "blocked"
            ? "BLOCKED"
            : stateSlot === "inspection" || stateSlot === "needs inspection"
              ? "NEEDS_INSPECTION"
              : stateSlot === "complete" || stateSlot === "completed"
                ? "COMPLETED"
                : "IN_PROGRESS"
    const proposed = proposeTaskUpdate(
      targetRun.id,
      task.taskKey,
      requestedState as typeof task.state,
      "Requested through Alexa voice assistant.",
      task.physicalCheckRequired ? "inspection" : "transition",
    )
    if (!proposed.ok) return proposed.error
    return `I proposed the update for ${task.name}. Please say confirm to apply it or cancel to keep the current record.`
  }

  if (intentName === "ConfirmUpdate") {
    const pending = getRunById(firstRun.id)
      ? (() => {
          const store = (globalThis as any).__cueStore ?? null
          return store?.pendingActions?.find((item: any) => item.status === "PENDING") ?? null
        })()
      : null
    if (!pending) return "There is no pending update to confirm."
    const result = confirmPendingUpdate(pending.id, true)
    if (!result.ok) return result.error
    return "Confirmed. The task state has been updated."
  }

  if (intentName === "CancelUpdate") {
    const pending = getRunById(firstRun.id)
      ? (() => {
          const store = (globalThis as any).__cueStore ?? null
          return store?.pendingActions?.find((item: any) => item.status === "PENDING") ?? null
        })()
      : null
    if (!pending) return "There is no pending update to cancel."
    const result = confirmPendingUpdate(pending.id, false)
    if (!result.ok) return result.error
    return "Cancelled. The production record was left unchanged."
  }

  if (request?.type === "LaunchRequest") {
    return `Welcome to CUE. Ask for the status, what can be done next, or ask about waiting tasks.`
  }

  return "I can help with status, ready work, waiting tasks, and confirmation for task updates."
}

export function createAlexaResponse(payload: any) {
  const speech = buildAlexaSpeech(payload)
  return NextResponse.json({
    version: "1.0",
    response: {
      shouldEndSession: true,
      outputSpeech: {
        type: "PlainText",
        text: speech,
      },
    },
  })
}
