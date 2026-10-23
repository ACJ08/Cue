"use client"

import { useMemo, useState } from "react"
import type { PendingAction, ProductionRun } from "@/lib/demo-types"
import { eligibleTasks, productName, progressFor, unmetPrerequisites } from "@/lib/workflow"
import { proposeTaskUpdate } from "@/lib/cue-api"

function stateLabel(state: string) {
  return state.replaceAll("_", " ").toLowerCase()
}

export default function DashboardClient({
  runs,
  pendingActions,
  onRefresh,
}: {
  runs: ProductionRun[]
  pendingActions: PendingAction[]
  onRefresh: () => Promise<void>
}) {
  const [actionError, setActionError] = useState("")
  const [selected, setSelected] = useState(runs[0]?.id ?? "")
  const active = useMemo(
    () => runs.find((run) => run.id === selected) ?? runs[0],
    [runs, selected],
  )

  async function handleTransition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const runId = String(form.get("runId") ?? "")
    const taskKey = String(form.get("taskKey") ?? "")
    const proposedState = String(form.get("proposedState") ?? "") as ProductionRun["tasks"][number]["state"]
    const reason = String(form.get("reason") ?? "")
    const actionType = String(form.get("actionType") ?? "transition")

    try {
      await proposeTaskUpdate(runId, taskKey, proposedState, reason, actionType)
      setActionError("Review the proposal above and confirm it before the run changes.")
      await onRefresh()
    } catch (error) {
      setActionError((error as Error).message)
    }
  }

  if (!active) return null

  return (
    <div className="dashboard-grid">
      <section className="run-workspace">
        <div className="run-tabs" role="tablist" aria-label="Production runs">
          {runs.map((run) => (
            <button
              className={run.id === active.id ? "is-active" : ""}
              key={run.id}
              onClick={() => setSelected(run.id)}
              role="tab"
              type="button"
            >
              <span>{productName(run)}</span>
              <small>{run.runId}</small>
            </button>
          ))}
        </div>
        <article className="run-card">
          {actionError && (
            <p className="form-alert" role="status">
              {actionError}
            </p>
          )}
          <header>
            <div>
              <p className="card-kicker">
                {active.runId} · {active.runType.replace("-", " ")}
              </p>
              <h2>{productName(active)}</h2>
            </div>
            <div className="progress-ring">
              <strong>{progressFor(active)}%</strong>
              <span>complete</span>
            </div>
          </header>
          <div className="run-summary" aria-label="Run status summary">
            <span>
              <strong>{eligibleTasks(active).length}</strong> eligible now
            </span>
            <span>
              <strong>{active.tasks.filter((task) => task.state === "WAITING").length}</strong> waiting
            </span>
            <span>
              <strong>{active.tasks.filter((task) => task.state === "BLOCKED").length}</strong> blocked
            </span>
            <span>
              <strong>{active.tasks.filter((task) => task.state === "NEEDS_INSPECTION").length}</strong> need inspection
            </span>
          </div>
          <div className="task-list">
            {active.tasks.map((task) => {
              const unmet = unmetPrerequisites(task, active.tasks)
              return (
                <div className="task-row" key={task.taskKey}>
                  <span className={`state-dot state-${task.state.toLowerCase()}`} />
                  <div className="task-copy">
                    <strong>{task.name}</strong>
                    <span>
                      {task.state === "BLOCKED"
                        ? task.blockedReason
                        : unmet.length
                          ? `Waiting on ${unmet.join(", ")}`
                          : task.waitingReason
                            ? `Physical check required after ${task.waitingReason}`
                            : task.category}
                    </span>
                  </div>
                  <span className={`state-badge state-${task.state.toLowerCase()}`}>
                    {stateLabel(task.state)}
                  </span>
                  <div className="task-actions">
                    {(["READY", "NOT_STARTED"].includes(task.state) && unmet.length === 0) && (
                      <form onSubmit={handleTransition}>
                        <input type="hidden" name="runId" value={active.id} />
                        <input type="hidden" name="taskKey" value={task.taskKey} />
                        <input type="hidden" name="proposedState" value="IN_PROGRESS" />
                        <button type="submit">Start</button>
                      </form>
                    )}
                    {task.state === "IN_PROGRESS" && (
                      <form onSubmit={handleTransition}>
                        <input type="hidden" name="runId" value={active.id} />
                        <input type="hidden" name="taskKey" value={task.taskKey} />
                        <input type="hidden" name="proposedState" value={task.waitingReason ? "WAITING" : task.physicalCheckRequired ? "NEEDS_INSPECTION" : "COMPLETED"} />
                        <button type="submit">{task.waitingReason ? "Start Waiting Stage" : task.physicalCheckRequired ? "Record Inspection" : "Complete"}</button>
                      </form>
                    )}
                    {task.state === "COMPLETED" && (
                      <details className="task-more">
                        <summary>Correct</summary>
                        <form onSubmit={handleTransition}>
                          <input type="hidden" name="runId" value={active.id} />
                          <input type="hidden" name="taskKey" value={task.taskKey} />
                          <input type="hidden" name="proposedState" value="READY" />
                          <input type="hidden" name="actionType" value="correction" />
                          <input name="reason" aria-label="Correction reason" placeholder="Reason for reopening" required />
                          <button type="submit">Correct Record</button>
                        </form>
                      </details>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </article>
      </section>
    </div>
  )
}
