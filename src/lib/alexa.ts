import type {
  PendingAction,
  ProductionRun,
  RunTask,
  TaskState,
} from "@/lib/demo-types"
import {
  eligibleTasks,
  productName,
  progressFor,
  unmetPrerequisites,
  validateTransition,
} from "@/lib/workflow"

export type AlexaIntent =
  | "status"
  | "next_task"
  | "waiting"
  | "inspection"
  | "confirm_update"
  | "cancel_update"
  | "blocked"
  | "switch_run"
  | "transition_task"
  | "help"
  | "greeting"
  | "unknown"

export type AlexaAction = {
  type: "transition" | "confirm" | "cancel" | "inspection" | "switch_run"
  taskKey?: string
  targetState?: TaskState
  runId?: string
  runCode?: string
  productName?: string
  pendingActionId?: string
  reason?: string
}

export type AlexaContext = {
  run?: ProductionRun
  runs?: ProductionRun[]
  pendingAction?: PendingAction | null
}

export type AlexaParseResult = {
  intent: AlexaIntent
  normalized: string
  run?: string
  runId?: string
  task?: string
  taskKey?: string
  response: string
  action?: AlexaAction
  cardTitle: string
  cardText: string
}

function normalizeText(value: string) {
  let clean = value.trim().toLowerCase().replace(/\s+/g, " ")
  // Clean off conversational wake-words like "Alexa, ", "Hey Alexa", "CUE, "
  clean = clean.replace(/^(?:(?:hey\s+)?alexa[,:]?\s*|cue[,:]?\s*)/, "").trim()
  return clean
}

function formatRecordedTime(value?: string | null) {
  if (!value) return "not recorded"
  const date = new Date(value)
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ]
  const hours = date.getUTCHours()
  const displayHours = hours % 12 || 12
  const minutes = date.getUTCMinutes().toString().padStart(2, "0")

  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${displayHours}:${minutes} ${
    hours >= 12 ? "PM" : "AM"
  } UTC`
}

function resolveSpecificRun(
  normalized: string,
  context?: AlexaContext,
): ProductionRun | undefined {
  if (!context) return undefined
  const runs = context.runs ?? (context.run ? [context.run] : [])
  if (!runs.length) return undefined

  // 1. Check for specific runId in speech
  for (const r of runs) {
    if (normalized.includes(r.runId.toLowerCase())) {
      return r
    }
  }

  // 2. Check for product name keywords
  for (const r of runs) {
    const name = productName(r).toLowerCase()
    if (
      normalized.includes(name) ||
      (name.includes("pistachio") && normalized.includes("pistachio")) ||
      (name.includes("cheesecake") && normalized.includes("cheesecake")) ||
      (name.includes("cookie") && normalized.includes("cookie")) ||
      (name.includes("chocolate") && normalized.includes("chocolate")) ||
      (name.includes("carrot") && normalized.includes("carrot")) ||
      (name.includes("sourdough") && normalized.includes("sourdough"))
    ) {
      return r
    }
  }

  return undefined
}

function findTargetRun(
  normalized: string,
  context?: AlexaContext,
): ProductionRun | undefined {
  const specific = resolveSpecificRun(normalized, context)
  if (specific) return specific

  // Fallback to active run or first available
  const runs = context?.runs ?? (context?.run ? [context.run] : [])
  return context?.run ?? runs[0]
}

function findTargetTask(
  normalized: string,
  run?: ProductionRun,
): RunTask | undefined {
  if (!run) return undefined
  for (const task of run.tasks) {
    const nameLower = task.name.toLowerCase()
    const keyLower = task.taskKey.toLowerCase()
    if (normalized.includes(keyLower) || normalized.includes(nameLower)) {
      return task
    }
    if (nameLower.includes("ingredient") && (normalized.includes("ingredient") || normalized.includes("prep"))) {
      return task
    }
    if (nameLower.includes("cooling") && normalized.includes("cool")) {
      return task
    }
    if (nameLower.includes("chilling") && normalized.includes("chill")) {
      return task
    }
    if (nameLower.includes("packaging") && (normalized.includes("packaging") || normalized.includes("pack"))) {
      return task
    }
    if (nameLower.includes("cook") && (normalized.includes("cook") || normalized.includes("bake"))) {
      return task
    }
    if (nameLower.includes("inspect") && (normalized.includes("inspect") || normalized.includes("quality"))) {
      return task
    }
    if (nameLower.includes("finish") && normalized.includes("finish")) {
      return task
    }
  }
  return undefined
}

export function parseAlexaIntent(
  value: string,
  context?: AlexaContext,
): AlexaParseResult {
  const normalized = normalizeText(value)

  if (!normalized) {
    return {
      intent: "unknown",
      normalized,
      response:
        "I'm ready to help with your baking production run. Try asking: 'What can I do next?' or 'What is waiting?'",
      cardTitle: "Alexa + CUE Assistant",
      cardText: "Ask CUE about run status, next eligible tasks, or waiting stages.",
    }
  }

  const runMatch = normalized.match(
    /(?:for|of|on|run)\s+([a-z0-9][a-z0-9 -]{1,40})/i,
  )
  const taskMatch = normalized.match(
    /(?:task|step|item|batch)\s+(?:named\s+)?([a-z0-9][a-z0-9 -]{1,40})/i,
  )

  const activeRun = findTargetRun(normalized, context)
  const matchedTask = findTargetTask(normalized, activeRun)

  // 1. GREETING & LAUNCH INTENT
  if (
    /^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|howdy|greetings|launch|open(?:\s+cue)?|start(?:\s+cue|\s+app)?$)/.test(
      normalized,
    ) ||
    normalized === "hi" ||
    normalized === "hello" ||
    normalized === "hey"
  ) {
    const greetingRun = activeRun ? ` for ${activeRun.runId} (${productName(activeRun)})` : ""
    return {
      intent: "greeting",
      normalized,
      run: activeRun?.runId,
      runId: activeRun?.id,
      response: `Hi there! I'm Alexa, your CUE baking workflow assistant${greetingRun}. You can ask me 'What can I do next?', 'What is waiting?', or check your batch progress.`,
      cardTitle: "Hello from Alexa + CUE",
      cardText: "Ask CUE about run status, next eligible tasks, or waiting stages.",
    }
  }

  // 2. COURTESY / THANKS INTENT
  if (/^(?:thanks|thank\s+you|appreciate\s+it)\b/.test(normalized)) {
    return {
      intent: "help",
      normalized,
      run: activeRun?.runId,
      runId: activeRun?.id,
      response:
        "You're very welcome! Let me know whenever you need workflow guidance or status updates on your batch.",
      cardTitle: "You're Welcome!",
      cardText: "Ask anytime about your baking run tasks and waiting stages.",
    }
  }

  // 3. HELP INTENT
  if (
    /^(?:help|commands|options)\b/.test(normalized) ||
    (/^(?:what can (?:i|you) (?:do|ask))\b/.test(normalized) &&
      !normalized.includes("next") &&
      !normalized.includes("eligible") &&
      !normalized.includes("ready"))
  ) {
    return {
      intent: "help",
      normalized,
      run: activeRun?.runId ?? runMatch?.[1]?.trim(),
      runId: activeRun?.id,
      response:
        "You can ask CUE about status ('What is the status?'), eligible work ('What can I do next?'), active waits ('What is waiting?'), blockers ('Why is it blocked?'), or inspection requirements.",
      cardTitle: "CUE Voice Commands",
      cardText:
        "• What can I do next?\n• What is waiting?\n• What is the status?\n• Why is a task blocked?\n• Mark inspection complete\n• Switch to DEMO-T4X",
    }
  }

  // 4. SWITCH RUN INTENT
  if (
    /^(?:switch|change|go|move|focus|select|view|show)\s+(?:to\s+|run\s+|batch\s+)?([a-z0-9 -]+)$/i.test(normalized) ||
    /^(?:switch|focus)\s+(?:run|batch)\b/i.test(normalized)
  ) {
    const specific = resolveSpecificRun(normalized, context)
    const runs = context?.runs ?? (context?.run ? [context.run] : [])
    let target = specific
    if (!target && /next|other/i.test(normalized) && runs.length > 1) {
      target = runs.find((r) => r.id !== activeRun?.id) ?? runs[0]
    }

    if (target) {
      const isAlreadyActive = Boolean(context?.run && context.run.id === target.id)
      const eligibleCount = eligibleTasks(target).length
      const progress = progressFor(target)
      const responseText = isAlreadyActive
        ? `You are already focused on ${target.runId} (${productName(target)}). Progress is at ${progress}%, with ${eligibleCount} tasks eligible.`
        : `Switched focus to ${target.runId} (${productName(target)}). Progress is at ${progress}% with ${eligibleCount} tasks eligible to work on.`

      return {
        intent: "switch_run",
        normalized,
        run: target.runId,
        runId: target.id,
        response: responseText,
        cardTitle: `Batch Focus: ${target.runId}`,
        cardText: `${productName(target)} • ${progress}% complete • ${eligibleCount} tasks eligible to work on.`,
        action: {
          type: "switch_run",
          runId: target.id,
          runCode: target.runId,
          productName: productName(target),
        },
      }
    }
  }

  // 2. WAITING INTENT
  if (
    /what.*(waiting|cooling|chilling|freezing)|is.*(waiting|cooling|chilling|freezing)|wait.*(time|status)|how.*long.*wait/.test(
      normalized,
    )
  ) {
    if (activeRun) {
      const waitingTasks = activeRun.tasks.filter((t) => t.state === "WAITING")
      const otherWork = eligibleTasks(activeRun).filter(
        (t) => t.state !== "WAITING",
      )

      if (waitingTasks.length) {
        const descriptions = waitingTasks.map((task) => {
          const reason = task.waitingReason ?? "waiting"
          const duration = task.expectedMinutes
            ? `estimated duration ${task.expectedMinutes} minutes`
            : "duration not configured"
          const startTime = formatRecordedTime(task.waitingStartedAt)
          const inspection = task.physicalCheckRequired
            ? "A physical inspection is required before completion."
            : "No physical check is required."
          return `${task.name}: ${reason} started ${startTime}, ${duration}. ${inspection}`
        })

        const parallelCandidates = [
          ...otherWork,
          ...activeRun.tasks.filter(
            (t) =>
              t.allowsParallel &&
              (t.state === "IN_PROGRESS" || t.state === "READY"),
          ),
        ]
        const uniqueParallel = Array.from(
          new Set(parallelCandidates.map((t) => t.name)),
        )

        const parallelInfo = uniqueParallel.length
          ? ` While waiting, you can work on ${uniqueParallel.join(", ")} in parallel.`
          : ""

        const responseText = `For ${activeRun.runId}, ${descriptions.join(" ")}${parallelInfo}`

        return {
          intent: "waiting",
          normalized,
          run: activeRun.runId,
          runId: activeRun.id,
          taskKey: waitingTasks[0]?.taskKey,
          response: responseText,
          cardTitle: `Waiting Stages — ${activeRun.runId}`,
          cardText: responseText,
        }
      }

      return {
        intent: "waiting",
        normalized,
        run: activeRun.runId,
        runId: activeRun.id,
        response: `Nothing is currently recorded as waiting in ${activeRun.runId} (${productName(activeRun)}).`,
        cardTitle: `No Active Waits — ${activeRun.runId}`,
        cardText: "All active tasks are either in progress, ready, or completed.",
      }
    }

    return {
      intent: "waiting",
      normalized,
      run: runMatch?.[1]?.trim(),
      response:
        "Waiting stage check requested. CUE can report recorded wait start times, estimated cooling or chilling durations, and required physical inspections.",
      cardTitle: "Waiting Stage Query",
      cardText: "Select or specify a production run to check active waiting stages.",
    }
  }

  // 3. NEXT TASK / ELIGIBILITY INTENT
  if (
    /what.*(next|eligible|ready|can.*do|should.*do)|next.*(task|step)|eligible.*work/.test(
      normalized,
    )
  ) {
    if (activeRun) {
      const eligible = eligibleTasks(activeRun)
      const inProgress = activeRun.tasks.filter(
        (t) => t.state === "IN_PROGRESS",
      )
      const needsInspection = activeRun.tasks.filter(
        (t) => t.state === "NEEDS_INSPECTION",
      )

      const parts: string[] = []

      if (needsInspection.length) {
        parts.push(
          `${needsInspection.map((t) => t.name).join(", ")} requires a physical inspection before it can complete.`,
        )
      }

      if (inProgress.length) {
        parts.push(
          `${inProgress.map((t) => t.name).join(", ")} is currently in progress and may be continued.`,
        )
      }

      if (eligible.length) {
        const readyItems = eligible.map(
          (t) =>
            `${t.name}${t.allowsParallel ? " (parallel work)" : ""}`,
        )
        parts.push(
          `Ready to start: ${readyItems.join(", ")}. All recorded prerequisites are satisfied.`,
        )
      }

      if (!parts.length) {
        parts.push(
          `No newly eligible work is ready for ${activeRun.runId}. Check ongoing waiting stages or resolve prerequisites.`,
        )
      }

      const responseText = `For ${activeRun.runId}: ${parts.join(" ")}`

      return {
        intent: "next_task",
        normalized,
        run: activeRun.runId,
        runId: activeRun.id,
        taskKey: eligible[0]?.taskKey ?? inProgress[0]?.taskKey,
        response: responseText,
        cardTitle: `Next Work — ${activeRun.runId}`,
        cardText: responseText,
      }
    }

    return {
      intent: "next_task",
      normalized,
      run: runMatch?.[1]?.trim(),
      response: `Next-task guidance requested${runMatch?.[1] ? ` for ${runMatch[1]}` : ""}. CUE surfaces tasks whose prerequisites are complete and highlights parallel work.`,
      cardTitle: "Next Task Guidance",
      cardText: "CUE checks recorded prerequisites and surfaces eligible tasks.",
    }
  }

  // 4. BLOCKERS / ISSUES INTENT
  if (/why.*block|is.*block|recorded.*block|obstacle|issue|stuck/.test(normalized)) {
    if (activeRun) {
      const blocked = activeRun.tasks.filter((t) => t.state === "BLOCKED")
      if (blocked.length) {
        const items = blocked.map((t) => {
          const unmet = unmetPrerequisites(t, activeRun.tasks)
          const reason =
            t.blockedReason ??
            t.qualityIssue ??
            (unmet.length
              ? `waiting on prerequisites: ${unmet.join(", ")}`
              : "no explicit reason recorded")
          return `${t.name}: ${reason}. Use a reasoned correction or inspection control on the board to resolve it.`
        })
        const responseText = `Blocked tasks for ${activeRun.runId}: ${items.join(" ")}`
        return {
          intent: "blocked",
          normalized,
          run: activeRun.runId,
          runId: activeRun.id,
          taskKey: blocked[0]?.taskKey,
          response: responseText,
          cardTitle: `Blockers — ${activeRun.runId}`,
          cardText: responseText,
        }
      }

      return {
        intent: "blocked",
        normalized,
        run: activeRun.runId,
        runId: activeRun.id,
        response: `No blocked tasks are recorded for ${activeRun.runId}. All active tasks are progressing normally.`,
        cardTitle: `No Blockers — ${activeRun.runId}`,
        cardText: "All tasks are clear of recorded obstacles.",
      }
    }

    return {
      intent: "blocked",
      normalized,
      response:
        "Blocker check requested. CUE records human-reported obstacles and quality inspection failures.",
      cardTitle: "Blocker Check",
      cardText: "Select a production run to view any recorded obstacles.",
    }
  }

  // 5. INSPECTION INTENT
  if (/inspection|quality.*check|check.*ready|pass.*inspection|verify/.test(normalized)) {
    if (activeRun) {
      const activeInspection = activeRun.tasks.find(
        (t) =>
          t.state === "NEEDS_INSPECTION" ||
          (t.state === "WAITING" && t.physicalCheckRequired),
      )
      const target =
        (matchedTask && matchedTask.state !== "NOT_STARTED"
          ? matchedTask
          : activeInspection) ?? matchedTask

      if (target) {
        const responseText = `Inspection for ${target.name} in ${activeRun.runId}: A physical check is required. Have you physically verified the condition? If so, click 'Confirm After Inspection' on the production board.`
        return {
          intent: "inspection",
          normalized,
          run: activeRun.runId,
          runId: activeRun.id,
          taskKey: target.taskKey,
          action: {
            type: "inspection",
            taskKey: target.taskKey,
            targetState: "COMPLETED",
            runId: activeRun.id,
          },
          response: responseText,
          cardTitle: `Inspection Verification — ${activeRun.runId}`,
          cardText: responseText,
        }
      }

      return {
        intent: "inspection",
        normalized,
        run: activeRun.runId,
        runId: activeRun.id,
        response: `No tasks currently require inspection in ${activeRun.runId}. Tasks requiring physical checks will prompt you once ready.`,
        cardTitle: `Inspection Status — ${activeRun.runId}`,
        cardText: "No pending inspection required right now.",
      }
    }

    return {
      intent: "inspection",
      normalized,
      task: taskMatch?.[1]?.trim(),
      response:
        "Inspection flow requested. CUE safeguards food quality by requiring a human physical check before completing cooling or waiting stages.",
      cardTitle: "Inspection Verification",
      cardText: "Inspections must be verified by a person before recording completion.",
    }
  }

  // 6. CONFIRM / CANCEL UPDATE INTENTS
  if (/cancel.*update|cancel|dismiss|abort/.test(normalized)) {
    if (context?.pendingAction && context.pendingAction.status === "PENDING") {
      return {
        intent: "cancel_update",
        normalized,
        run: activeRun?.runId,
        runId: activeRun?.id,
        taskKey: context.pendingAction.taskKey,
        action: {
          type: "cancel",
          runId: activeRun?.id,
          pendingActionId: context.pendingAction.id,
        },
        response:
          "You can cancel the proposed update directly on the board. Cancelling leaves the production run completely unchanged.",
        cardTitle: "Cancel Proposed Update",
        cardText: "Click Cancel on the board proposal to keep current state.",
      }
    }
    return {
      intent: "cancel_update",
      normalized,
      response: "There is no pending update proposal to cancel.",
      cardTitle: "No Pending Update",
      cardText: "The production board has no active proposals awaiting review.",
    }
  }

  if (/confirm|mark .* complete|finish.*task|apply.*update/.test(normalized)) {
    if (context?.pendingAction && context.pendingAction.status === "PENDING") {
      const pending = context.pendingAction
      const task = activeRun?.tasks.find((t) => t.taskKey === pending.taskKey)
      const responseText = `Reviewing proposal for ${task?.name ?? pending.taskKey} moving to ${pending.proposedState.toLowerCase().replace(/_/g, " ")}. Confirming will update the board; click 'Confirm' on the board proposal.`

      return {
        intent: "confirm_update",
        normalized,
        run: activeRun?.runId,
        runId: activeRun?.id,
        taskKey: pending.taskKey,
        action: {
          type: "confirm",
          taskKey: pending.taskKey,
          targetState: pending.proposedState as TaskState,
          runId: activeRun?.id,
          pendingActionId: pending.id,
        },
        response: responseText,
        cardTitle: "Confirm Proposed Update",
        cardText: responseText,
      }
    }

    return {
      intent: "confirm_update",
      normalized,
      task: taskMatch?.[1]?.trim(),
      response:
        "Update confirmation requested. In CUE, task updates are first proposed on the production board for baker review before being written to local storage.",
      cardTitle: "Update Confirmation Guard",
      cardText: "Propose a task change on the board to review and confirm it.",
    }
  }

  // 7. TASK TRANSITION INTENT ("Alexa, start cook-main", "Alexa, complete prepare-ingredients", "Alexa, start mixing")
  const isStart = /^(?:start|begin|commence)\s+(?:task\s+|step\s+)?([a-z0-9 -]+)/i.test(normalized)
  const isComplete = /^(?:complete|finish|done)\s+(?:task\s+|step\s+)?([a-z0-9 -]+)/i.test(normalized)
  const isWait = /^(?:wait|cool|chill|freeze)\s+(?:task\s+|step\s+)?([a-z0-9 -]+)/i.test(normalized)

  if (activeRun && (isStart || isComplete || isWait) && matchedTask && !context?.pendingAction) {
    let targetState: TaskState = "IN_PROGRESS"
    if (isComplete) targetState = "COMPLETED"
    if (isWait) targetState = "WAITING"

    const validation = validateTransition(activeRun, matchedTask.taskKey, targetState)
    if (!validation.ok) {
      return {
        intent: "transition_task",
        normalized,
        run: activeRun.runId,
        runId: activeRun.id,
        taskKey: matchedTask.taskKey,
        response: `Cannot transition ${matchedTask.name} to ${targetState.toLowerCase().replace(/_/g, " ")}. ${validation.error}`,
        cardTitle: `Blocked Transition — ${matchedTask.name}`,
        cardText: validation.error,
      }
    }

    if (matchedTask.physicalCheckRequired && targetState === "COMPLETED") {
      const responseText = `Physical inspection is required for ${matchedTask.name} before completing. I have staged an inspection sign-off. Please confirm once physically checked.`
      return {
        intent: "inspection",
        normalized,
        run: activeRun.runId,
        runId: activeRun.id,
        taskKey: matchedTask.taskKey,
        response: responseText,
        cardTitle: `Physical Inspection Required — ${matchedTask.name}`,
        cardText: `Verify physical condition for ${matchedTask.name} before marking complete.`,
        action: {
          type: "inspection",
          taskKey: matchedTask.taskKey,
          targetState: "COMPLETED",
          runId: activeRun.id,
        },
      }
    }

    const responseText = `I've prepared a proposal to move ${matchedTask.name} to ${targetState.toLowerCase().replace(/_/g, " ")}. Confirming will update the production board.`
    return {
      intent: "transition_task",
      normalized,
      run: activeRun.runId,
      runId: activeRun.id,
      taskKey: matchedTask.taskKey,
      response: responseText,
      cardTitle: `Propose Transition: ${matchedTask.name}`,
      cardText: `Move ${matchedTask.name} to ${targetState.replace(/_/g, " ")}.`,
      action: {
        type: "transition",
        taskKey: matchedTask.taskKey,
        targetState,
        runId: activeRun.id,
      },
    }
  }

  // 7. STATUS / PROGRESS INTENT
  if (
    /status|progress|how.*(going|far)|overview|report|complete|done/.test(
      normalized,
    )
  ) {
    if (activeRun) {
      const progress = progressFor(activeRun)
      const completed = activeRun.tasks.filter((t) => t.state === "COMPLETED")
      const mandatory = activeRun.tasks.filter((t) => t.mandatory !== false)
      const waiting = activeRun.tasks.filter((t) => t.state === "WAITING")
      const blocked = activeRun.tasks.filter((t) => t.state === "BLOCKED")
      const inProgress = activeRun.tasks.filter((t) => t.state === "IN_PROGRESS")

      const statusDetails: string[] = []
      if (waiting.length) {
        statusDetails.push(
          `${waiting
            .map((t) => `${t.name} (${t.waitingReason ?? "waiting"})`)
            .join(", ")} is waiting`,
        )
      }
      if (inProgress.length) {
        statusDetails.push(`${inProgress.map((t) => t.name).join(", ")} is in progress`)
      }
      if (blocked.length) {
        statusDetails.push(`${blocked.map((t) => t.name).join(", ")} is blocked`)
      }

      const details = statusDetails.length
        ? `. Current activity: ${statusDetails.join(", ")}.`
        : "."

      const responseText = `${activeRun.runId} (${productName(activeRun)}) is ${progress}% complete with ${completed.length} of ${mandatory.length} required tasks completed${details}`

      return {
        intent: "status",
        normalized,
        run: activeRun.runId,
        runId: activeRun.id,
        response: responseText,
        cardTitle: `Status — ${activeRun.runId} (${progress}%)`,
        cardText: responseText,
      }
    }

    return {
      intent: "status",
      normalized,
      run: runMatch?.[1]?.trim(),
      response: `Status check requested${runMatch?.[1] ? ` for ${runMatch[1]}` : ""}. CUE reads the recorded workflow state and reports progress, waiting stages, and blocked tasks.`,
      cardTitle: "Status Check",
      cardText: "Select a production run to view real-time progress.",
    }
  }

  // 8. UNKNOWN FALLBACK
  return {
    intent: "unknown",
    normalized,
    run: activeRun?.runId,
    runId: activeRun?.id,
    response: `CUE heard '${value}', but did not match a known command. Try asking 'What can I do next?', 'What is waiting?', or 'What is the status?'`,
    cardTitle: "Command Not Recognized",
    cardText: "Try asking about next work, waiting tasks, or run status.",
  }
}

export function buildAlexaResponse(input: string, context?: AlexaContext) {
  return parseAlexaIntent(input, context)
}

export function getDynamicSuggestions(
  activeRun?: ProductionRun,
  pendingAction?: PendingAction | null,
  allRuns?: ProductionRun[],
): string[] {
  const suggestions: string[] = []

  // 1. Pending action
  if (pendingAction && pendingAction.status === "PENDING") {
    suggestions.push("Alexa, confirm update")
    suggestions.push("Alexa, cancel update")
  }

  if (activeRun) {
    // 2. Waiting inspection
    const waitingInspection = activeRun.tasks.find(
      (t) =>
        t.state === "NEEDS_INSPECTION" ||
        (t.state === "WAITING" && t.physicalCheckRequired),
    )
    if (waitingInspection) {
      suggestions.push("Alexa, mark the inspection complete")
    }

    // 3. Blocked task
    const blocked = activeRun.tasks.find((t) => t.state === "BLOCKED")
    if (blocked) {
      suggestions.push(`Alexa, why is ${blocked.taskKey} blocked?`)
    }

    // 4. Eligible tasks ready
    const eligible = eligibleTasks(activeRun).filter((t) => t.state === "READY")
    if (eligible.length > 0) {
      suggestions.push("Alexa, what can I do next?")
      suggestions.push(`Alexa, start ${eligible[0].taskKey}`)
    } else {
      suggestions.push("Alexa, what can I do next?")
    }

    // 5. Waiting check
    const isWaiting = activeRun.tasks.some((t) => t.state === "WAITING")
    if (isWaiting) {
      suggestions.push("Alexa, what is waiting?")
    }

    // 6. Status check
    suggestions.push(`Alexa, what is the status of ${activeRun.runId}?`)

    // 7. Alternate batch
    if (allRuns && allRuns.length > 1) {
      const otherRun = allRuns.find((r) => r.id !== activeRun.id)
      if (otherRun) {
        suggestions.push(`Alexa, switch to ${otherRun.runId}`)
      }
    }
  } else {
    suggestions.push("Alexa, what can I do next?")
    suggestions.push("Alexa, what is waiting?")
    suggestions.push("Alexa, what is the status?")
  }

  return Array.from(new Set(suggestions)).slice(0, 5)
}
