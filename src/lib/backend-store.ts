import fs from "node:fs"
import path from "node:path"
import { createInitialDemoState } from "./demo-data"
import type { DemoState } from "./demo-data"
import type { PendingAction, ProductionRun } from "./demo-types"
import { validateTransition } from "./workflow"

const STORE_DIR = path.join(process.cwd(), "data")
const STORE_PATH = path.join(STORE_DIR, "cue-store.json")

function defaultStore(): DemoState {
  const seeded = createInitialDemoState()
  seeded.user = {
    id: "demo-user",
    name: "Baker Demo",
    email: "demo@cue.local",
    accountType: "demo",
    collection: "users",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  return seeded
}

export function resolveStorePath() {
  return STORE_PATH
}

function readStore(): DemoState {
  try {
    fs.mkdirSync(STORE_DIR, { recursive: true })
    if (!fs.existsSync(STORE_PATH)) {
      const seeded = defaultStore()
      fs.writeFileSync(STORE_PATH, JSON.stringify(seeded, null, 2))
      return seeded
    }
    const read = fs.readFileSync(STORE_PATH, "utf8")
    const parsed = JSON.parse(read) as Partial<DemoState>
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.runs) ||
      !Array.isArray(parsed.pendingActions)
    ) {
      throw new Error("Invalid backend store")
    }
    return {
      version: 1,
      user: parsed.user ?? defaultStore().user ?? null,
      runs: parsed.runs,
      pendingActions: parsed.pendingActions,
    }
  } catch {
    const seeded = defaultStore()
    fs.writeFileSync(STORE_PATH, JSON.stringify(seeded, null, 2))
    return seeded
  }
}

export function getStore(): DemoState {
  return readStore()
}

export function saveStore(next: DemoState) {
  fs.mkdirSync(STORE_DIR, { recursive: true })
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2))
  return next
}

export function getRunById(runId: string) {
  return getStore().runs.find((item) => item.id === runId) ?? null
}

export function getCurrentUser() {
  const store = getStore()
  if (!store.user) {
    const demoUser = defaultStore().user
    if (!demoUser) return null
    store.user = demoUser
    saveStore(store)
  }
  return store.user
}

export function listRuns() {
  return getStore().runs
}

export function getStatusSummary(run: ProductionRun) {
  return {
    runId: run.runId,
    product: typeof run.product === "object" ? run.product.name : run.product,
    eligibleCount: run.tasks.filter((task) => task.state === "READY").length,
    waitingCount: run.tasks.filter((task) => task.state === "WAITING").length,
    blockedCount: run.tasks.filter((task) => task.state === "BLOCKED").length,
    inspectionCount: run.tasks.filter((task) => task.state === "NEEDS_INSPECTION")
      .length,
    totalTasks: run.tasks.length,
    completionPercent: Math.round(
      (run.tasks.filter((task) => task.state === "COMPLETED").length /
        run.tasks.length) *
        100,
    ),
  }
}

export function proposeTaskUpdate(
  runId: string,
  taskKey: string,
  nextState: ProductionRun["tasks"][number]["state"],
  reason = "",
  actionType: PendingAction["actionType"] = "transition",
) {
  const store = getStore()
  const run = store.runs.find((item) => item.id === runId)
  const task = run?.tasks.find((item) => item.taskKey === taskKey)
  if (!run || !task) {
    return { ok: false as const, error: "That task or run is no longer available." }
  }

  const validation = validateTransition(run, taskKey, nextState)
  if (!validation.ok) {
    return validation
  }
  if (actionType === "correction" && !reason.trim()) {
    return { ok: false as const, error: "A correction requires a reason." }
  }

  const pending = store.pendingActions.find(
    (item) =>
      item.productionRun === run.id &&
      item.taskKey === taskKey &&
      item.status === "PENDING",
  )
  if (pending) {
    return {
      ok: false as const,
      error: "Review or cancel the pending confirmation first.",
    }
  }

  const pendingAction: PendingAction = {
    id: `pending-${crypto.randomUUID()}`,
    owner: store.user?.id ?? "demo-user",
    productionRun: run.id,
    taskKey,
    expectedState: task.state,
    proposedState: nextState,
    actionType,
    reason: reason || undefined,
    status: "PENDING",
    snapshotVersion: run.version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const nextStore = { ...store, pendingActions: [...store.pendingActions, pendingAction] }
  saveStore(nextStore)
  return { ok: true as const, pendingAction }
}

export function confirmPendingUpdate(id: string, confirm: boolean) {
  const store = getStore()
  const pending = store.pendingActions.find(
    (item) => item.id === id && item.status === "PENDING",
  )
  if (!pending) {
    return { ok: false as const, error: "That proposal is no longer available." }
  }

  const run = store.runs.find((item) => item.id === pending.productionRun)
  const task = run?.tasks.find((item) => item.taskKey === pending.taskKey)
  if (!run || !task) {
    return { ok: false as const, error: "That proposal is no longer available." }
  }

  if (run.version !== pending.snapshotVersion || task.state !== pending.expectedState) {
    const nextStore = {
      ...store,
      pendingActions: store.pendingActions.map((item) =>
        item.id === id ? { ...item, status: "STALE" } : item,
      ),
    }
    saveStore(nextStore)
    return {
      ok: false as const,
      error: "The run changed. Review its latest state before trying again.",
    }
  }

  if (!confirm) {
    const nextStore = {
      ...store,
      pendingActions: store.pendingActions.map((item) =>
        item.id === id ? { ...item, status: "CANCELLED" } : item,
      ),
    }
    saveStore(nextStore)
    return { ok: true as const }
  }

  const nextState = pending.proposedState as ProductionRun["tasks"][number]["state"]
  const now = new Date().toISOString()
  const tasks = run.tasks.map((item) =>
    item.taskKey !== task.taskKey
      ? item
      : {
          ...item,
          state: nextState,
          startedAt: nextState === "IN_PROGRESS" ? now : item.startedAt,
          waitingStartedAt: nextState === "WAITING" ? now : item.waitingStartedAt,
          completedAt: nextState === "COMPLETED" ? now : undefined,
          readinessConfirmedAt:
            pending.actionType === "inspection" && nextState === "COMPLETED"
              ? now
              : item.readinessConfirmedAt,
          blockedReason: nextState === "BLOCKED" ? pending.reason : undefined,
          qualityStatus:
            pending.actionType === "inspection"
              ? nextState === "COMPLETED"
                ? "PASSED"
                : nextState === "BLOCKED"
                  ? "FAILED"
                  : item.qualityStatus
              : item.qualityStatus,
          qualityIssue:
            pending.actionType === "inspection" && nextState === "BLOCKED"
              ? pending.reason
              : item.qualityIssue,
        },
  )

  const completed = new Set(
    tasks.filter((item) => item.state === "COMPLETED").map((item) => item.taskKey),
  )
  const refreshed = tasks.map((item) => {
    const ready =
      (item.prerequisites ?? []).every((pre) => completed.has(pre.taskKey)) &&
      (item.waitingReason !== "freezing" || Boolean(run.selectedProcess))
    return item.state === "NOT_STARTED" && ready
      ? { ...item, state: "READY" }
      : item.state === "READY" && !ready
        ? { ...item, state: "NOT_STARTED" }
        : item
  })

  const done = refreshed
    .filter((item) => item.mandatory !== false)
    .every((item) => item.state === "COMPLETED")

  const nextStore = {
    ...store,
    runs: store.runs.map((item) =>
      item.id === run.id
        ? {
            ...item,
            tasks: refreshed,
            version: item.version + 1,
            status: done ? "COMPLETED" : "IN_PROGRESS",
            history: [
              ...(item.history ?? []),
              {
                taskKey: task.taskKey,
                fromState: task.state,
                toState: nextState,
                reason: pending.reason,
                actor: store.user?.name ?? "Baker",
                recordedAt: now,
              },
            ],
            updatedAt: now,
          }
        : item,
    ),
    pendingActions: store.pendingActions.map((item) =>
      item.id === id ? { ...item, status: "CONFIRMED" } : item,
    ),
  }

  saveStore(nextStore)
  return { ok: true as const }
}
