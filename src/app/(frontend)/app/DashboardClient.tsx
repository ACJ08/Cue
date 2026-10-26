"use client"

import { useMemo, useState, useEffect } from "react"
import type { ProductionRun } from "@/lib/demo-types"
import {
  eligibleTasks,
  productName,
  progressFor,
  unmetPrerequisites,
} from "@/lib/workflow"
import { transitionRun, useDemoState } from "@/lib/demo-storage"

function stateLabel(state: string) {
  return state.replaceAll("_", " ").toLowerCase()
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

export default function DashboardClient({ runs }: { runs: ProductionRun[] }) {
  const { state: data } = useDemoState()
  const [actionError, setActionError] = useState("")
  function handleTransition(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const result = transitionRun(
      String(form.get("runId") ?? ""),
      String(form.get("taskKey") ?? ""),
      String(
        form.get("proposedState") ?? "",
      ) as ProductionRun["tasks"][number]["state"],
      String(form.get("reason") ?? ""),
      String(form.get("actionType") ?? "transition"),
    )
    setActionError(
      result.ok
        ? "Review the proposal above and confirm it before the run changes."
        : result.error,
    )
  }
  const currentRuns = data.runs.length ? (data.runs as ProductionRun[]) : runs
  const [selected, setSelected] = useState(runs[0]?.id)

  useEffect(() => {
    function handleSelectRun(e: Event) {
      const customEvent = e as CustomEvent<{ runId: string }>
      if (customEvent.detail?.runId) {
        setSelected(customEvent.detail.runId)
      }
    }
    window.addEventListener("cue:select-run", handleSelectRun)
    return () => {
      window.removeEventListener("cue:select-run", handleSelectRun)
    }
  }, [])

  const active = useMemo(
    () => currentRuns.find((run) => run.id === selected) ?? currentRuns[0],
    [currentRuns, selected],
  )
  if (!active) return null

  return (
    <div className="dashboard-grid">
      <section className="run-workspace">
        <div className="run-tabs" role="tablist" aria-label="Production runs">
          {currentRuns.map((run) => (
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
              <strong>
                {active.tasks.filter((task) => task.state === "WAITING").length}
              </strong>{" "}
              waiting
            </span>
            <span>
              <strong>
                {active.tasks.filter((task) => task.state === "BLOCKED").length}
              </strong>{" "}
              blocked
            </span>
            <span>
              <strong>
                {
                  active.tasks.filter(
                    (task) => task.state === "NEEDS_INSPECTION",
                  ).length
                }
              </strong>{" "}
              need inspection
            </span>
          </div>
          <div className="task-list">
            {active.tasks.map((task) => {
              const unmet = unmetPrerequisites(task, active.tasks)
              return (
                <div
                  className="task-row"
                  key={task.taskKey}
                  id={`task-${task.taskKey}`}
                >
                  <span
                    className={`state-dot state-${task.state.toLowerCase()}`}
                  />
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
                    <details className="task-details">
                      <summary>Review task details</summary>
                      <dl>
                        <div>
                          <dt>State</dt>
                          <dd>{stateLabel(task.state)}</dd>
                        </div>
                        <div>
                          <dt>Prerequisites</dt>
                          <dd>
                            {task.prerequisites
                              ?.map((item) => item.taskKey)
                              .join(", ") || "None"}
                          </dd>
                        </div>
                        <div>
                          <dt>Waiting reason</dt>
                          <dd>{task.waitingReason ?? "Not applicable"}</dd>
                        </div>
                        <div>
                          <dt>Physical check</dt>
                          <dd>
                            {task.physicalCheckRequired
                              ? "Required"
                              : "Not required"}
                          </dd>
                        </div>
                        <div>
                          <dt>Started</dt>
                          <dd>{formatRecordedTime(task.startedAt)}</dd>
                        </div>
                        <div>
                          <dt>Waiting started</dt>
                          <dd>{formatRecordedTime(task.waitingStartedAt)}</dd>
                        </div>
                        <div>
                          <dt>Completed</dt>
                          <dd>{formatRecordedTime(task.completedAt)}</dd>
                        </div>
                        <div>
                          <dt>Quality</dt>
                          <dd>
                            {task.qualityStatus?.toLowerCase() ?? "not recorded"}
                          </dd>
                        </div>
                        {task.blockedReason && (
                          <div>
                            <dt>Blocking reason</dt>
                            <dd>{task.blockedReason}</dd>
                          </div>
                        )}
                        {task.qualityIssue && (
                          <div>
                            <dt>Quality issue</dt>
                            <dd>{task.qualityIssue}</dd>
                          </div>
                        )}
                      </dl>
                    </details>
                  </div>
                  <span
                    className={`state-badge state-${task.state.toLowerCase()}`}
                  >
                    {stateLabel(task.state)}
                  </span>
                  <div className="task-actions">
                    {["READY", "NOT_STARTED"].includes(task.state) &&
                      unmet.length === 0 && (
                        <form onSubmit={handleTransition}>
                          <input type="hidden" name="runId" value={active.id} />
                          <input
                            type="hidden"
                            name="taskKey"
                            value={task.taskKey}
                          />
                          <input
                            type="hidden"
                            name="proposedState"
                            value="IN_PROGRESS"
                          />
                          <button type="submit">Start</button>
                        </form>
                      )}
                    {task.state === "IN_PROGRESS" && (
                      <form onSubmit={handleTransition}>
                        <input type="hidden" name="runId" value={active.id} />
                        <input
                          type="hidden"
                          name="taskKey"
                          value={task.taskKey}
                        />
                        <input
                          type="hidden"
                          name="proposedState"
                          value={
                            task.waitingReason
                              ? "WAITING"
                              : task.physicalCheckRequired
                                ? "NEEDS_INSPECTION"
                                : "COMPLETED"
                          }
                        />
                        <button type="submit">
                          {task.waitingReason
                            ? "Start Waiting Stage"
                            : task.physicalCheckRequired
                              ? "Record Inspection"
                              : "Complete"}
                        </button>
                      </form>
                    )}
                    {["WAITING", "NEEDS_INSPECTION"].includes(task.state) &&
                      task.physicalCheckRequired && (
                        <form onSubmit={handleTransition}>
                          <input type="hidden" name="runId" value={active.id} />
                          <input
                            type="hidden"
                            name="taskKey"
                            value={task.taskKey}
                          />
                          <input
                            type="hidden"
                            name="proposedState"
                            value="COMPLETED"
                          />
                          <button type="submit">
                            Confirm After Inspection
                          </button>
                        </form>
                      )}
                    {["WAITING", "NEEDS_INSPECTION"].includes(task.state) &&
                      task.physicalCheckRequired && (
                        <details className="task-more">
                          <summary>Report issue</summary>
                          <form onSubmit={handleTransition}>
                            <input
                              type="hidden"
                              name="runId"
                              value={active.id}
                            />
                            <input
                              type="hidden"
                              name="taskKey"
                              value={task.taskKey}
                            />
                            <input
                              type="hidden"
                              name="proposedState"
                              value="BLOCKED"
                            />
                            <input
                              type="hidden"
                              name="actionType"
                              value="inspection"
                            />
                            <input
                              name="reason"
                              aria-label="Quality issue"
                              placeholder="What failed inspection?"
                              required
                            />
                            <button type="submit">
                              Mark Inspection Failed
                            </button>
                          </form>
                        </details>
                      )}
                    {task.state === "COMPLETED" && (
                      <details className="task-more">
                        <summary>Correct</summary>
                        <form onSubmit={handleTransition}>
                          <input type="hidden" name="runId" value={active.id} />
                          <input
                            type="hidden"
                            name="taskKey"
                            value={task.taskKey}
                          />
                          <input
                            type="hidden"
                            name="proposedState"
                            value="READY"
                          />
                          <input
                            type="hidden"
                            name="actionType"
                            value="correction"
                          />
                          <input
                            name="reason"
                            aria-label="Correction reason"
                            placeholder="Reason for reopening"
                            required
                          />
                          <button type="submit">Correct Record</button>
                        </form>
                      </details>
                    )}
                    {task.state === "BLOCKED" && (
                      <details className="task-more">
                        <summary>Resolve</summary>
                        <form onSubmit={handleTransition}>
                          <input type="hidden" name="runId" value={active.id} />
                          <input
                            type="hidden"
                            name="taskKey"
                            value={task.taskKey}
                          />
                          <input
                            type="hidden"
                            name="proposedState"
                            value="READY"
                          />
                          <input
                            type="hidden"
                            name="actionType"
                            value="correction"
                          />
                          <input
                            name="reason"
                            aria-label="Resolution reason"
                            placeholder="What resolved the blocker?"
                            required
                          />
                          <button type="submit">Review Resolution</button>
                        </form>
                      </details>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="completion-panels">
            <section>
              <p className="card-kicker">Inspection and quality</p>
              <h3>Outstanding checks</h3>
              <ul>
                {active.tasks
                  .filter(
                    (task) =>
                      task.physicalCheckRequired && task.state !== "COMPLETED",
                  )
                  .map((task) => (
                    <li key={task.taskKey}>
                      {task.name} · {stateLabel(task.state)}
                    </li>
                  ))}
                {!active.tasks.some(
                  (task) =>
                    task.physicalCheckRequired && task.state !== "COMPLETED",
                ) && <li>No outstanding physical checks.</li>}
              </ul>
            </section>
            <section>
              <p className="card-kicker">Finishing and packing</p>
              <h3>Completion conditions</h3>
              <ul>
                {active.tasks
                  .filter(
                    (task) =>
                      ["finishing", "packing", "storage"].includes(
                        task.category,
                      ) && task.state !== "COMPLETED",
                  )
                  .map((task) => (
                    <li key={task.taskKey}>
                      {task.name} · {stateLabel(task.state)}
                    </li>
                  ))}
                {!active.tasks.some(
                  (task) =>
                    ["finishing", "packing", "storage"].includes(
                      task.category,
                    ) && task.state !== "COMPLETED",
                ) && <li>All finishing requirements are complete.</li>}
              </ul>
            </section>
          </div>
        </article>
      </section>
    </div>
  )
}
