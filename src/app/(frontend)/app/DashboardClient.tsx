"use client"

import { useMemo, useState, useTransition } from "react"
import type { ProductionRun } from "@/lib/demo-types"
import { buildAlexaResponse, type AlexaAction } from "@/lib/alexa"
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

type ChatView = {
  kind: "informational" | "thinking" | "clarifying" | "error"
  title: string
  lines: string[]
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

function CueChat({
  runs,
  selectedRun,
}: {
  runs: ProductionRun[]
  selectedRun?: ProductionRun
}) {
  const activeRun = selectedRun ?? runs[0]

  if (!activeRun) {
    return (
      <aside className="cue-chat" aria-live="polite">
        <div className="cue-chat-head">
          <div>
            <strong>Ask CUE</strong>
            <small>Select a production run to ask CUE a question.</small>
          </div>
          <img src="/cue/logo.png" alt="CUE assistant" />
        </div>
      </aside>
    )
  }

  return <CueChatContent runs={runs} selectedRun={activeRun} />
}

function CueChatContent({
  runs,
  selectedRun,
}: {
  runs: ProductionRun[]
  selectedRun: ProductionRun
}) {
  const { state: data } = useDemoState()
  const [query, setQuery] = useState("")
  const [isThinking, startThinking] = useTransition()
  const [view, setView] = useState<ChatView>({
    kind: "informational",
    title: `Ready to review ${selectedRun.runId}`,
    lines: [
      "Choose a demonstration question or ask about status, dependencies, waiting, or completed work.",
    ],
  })
  const suggestions = [
    "What can I do next?",
    "What is waiting?",
    "Why is something blocked?",
  ]
  const voiceSuggestions = [
    "Alexa, what can I do next?",
    "Alexa, what is waiting?",
    "Alexa, what is the status?",
    "Alexa, why is it blocked?",
    "Alexa, mark the inspection complete.",
  ]
  const [voiceQuery, setVoiceQuery] = useState("Alexa, what can I do next?")
  const [voiceResult, setVoiceResult] = useState<{
    intent: string
    response: string
    action?: AlexaAction
  } | null>(null)
  const [voiceLoading, setVoiceLoading] = useState(false)

  function calculate(value: string): ChatView {
    const lower = value.toLowerCase()
    const matched = runs.filter(
      (run) =>
        lower.includes(run.runId.toLowerCase()) ||
        lower.includes(productName(run).toLowerCase()),
    )
    const looksLikeRunId = /\b(?:demo|cue)-[a-z0-9-]+\b/i.test(value)
    if (looksLikeRunId && matched.length === 0) {
      return {
        kind: "clarifying",
        title: "I need a valid run identifier",
        lines: [
          `I could not find that run. Select one of: ${runs.map((run) => run.runId).join(", ")}.`,
        ],
      }
    }
    if (matched.length > 1) {
      return {
        kind: "clarifying",
        title: "Which production run do you mean?",
        lines: matched.map((run) => `${run.runId} — ${productName(run)}`),
      }
    }
    const run = matched[0] ?? selectedRun

    if (
      lower.includes("next") ||
      lower.includes("ready") ||
      lower.includes("eligible")
    ) {
      const eligible = eligibleTasks(run)
      const activeWork = run.tasks.filter(
        (task) => task.state === "IN_PROGRESS",
      )
      const inspections = run.tasks.filter(
        (task) => task.state === "NEEDS_INSPECTION",
      )
      const unavailable = run.tasks
        .filter(
          (task) => task.state === "NOT_STARTED" && !eligible.includes(task),
        )
        .slice(0, 3)
      return {
        kind: "informational",
        title:
          eligible.length || activeWork.length || inspections.length
            ? `Valid next actions for ${run.runId}`
            : `No newly eligible work for ${run.runId}`,
        lines: [
          ...inspections.map(
            (task) =>
              `${task.name}: record the required physical inspection before completion.`,
          ),
          ...activeWork.map(
            (task) =>
              `${task.name}: active work is already underway and may be continued.`,
          ),
          ...eligible.map((task) => {
            const parallel = task.allowsParallel
              ? " It is explicitly configured as parallel work."
              : ""
            return `${task.name}: all recorded prerequisites are complete.${parallel}`
          }),
          ...unavailable.map((task) => {
            const unmet = unmetPrerequisites(task, run.tasks)
            const reason =
              task.waitingReason === "freezing" && !run.selectedProcess
                ? "a freezing process must be selected"
                : `requires ${unmet.join(", ") || "additional configured conditions"}`
            return `${task.name} remains unavailable: ${reason}.`
          }),
        ],
      }
    }
    if (lower.includes("waiting")) {
      const waiting = run.tasks.filter((task) => task.state === "WAITING")
      const otherWork = eligibleTasks(run).filter(
        (task) => task.state !== "WAITING",
      )
      return {
        kind: waiting.length ? "informational" : "clarifying",
        title: waiting.length
          ? `Waiting stages for ${run.runId}`
          : `Nothing is currently waiting in ${run.runId}`,
        lines: [
          ...waiting.map(
            (task) =>
              `${task.name}: ${task.waitingReason ?? "waiting"} started ${formatRecordedTime(task.waitingStartedAt)}; estimated duration ${
                task.expectedMinutes
                  ? `${task.expectedMinutes} minutes`
                  : "not configured"
              }; ${
                task.physicalCheckRequired
                  ? "physical inspection is required before completion"
                  : "no physical check is configured"
              }.`,
          ),
          ...(otherWork.length
            ? [
                `Available while waiting: ${otherWork.map((task) => task.name).join(", ")}.`,
              ]
            : []),
        ],
      }
    }
    if (lower.includes("block") || lower.includes("why")) {
      const blocked = run.tasks.filter((task) => task.state === "BLOCKED")
      return {
        kind: blocked.length ? "informational" : "clarifying",
        title: blocked.length
          ? `Recorded blockers for ${run.runId}`
          : `No blocked task is recorded for ${run.runId}`,
        lines: blocked.length
          ? blocked.map((task) => {
              const unmet = unmetPrerequisites(task, run.tasks)
              return `${task.name}: ${task.blockedReason ?? task.qualityIssue ?? (unmet.length ? `waiting on ${unmet.join(", ")}` : "the record does not include a reason")}. ${
                task.physicalCheckRequired
                  ? "Use the inspection controls to record a valid resolution."
                  : "Use a reasoned correction to resolve the record."
              }`
            })
          : [
              "Select another run or ask about a specific task if you expected a blocker.",
            ],
      }
    }
    if (
      lower.includes("complete") ||
      lower.includes("done") ||
      lower.includes("status")
    ) {
      const completed = run.tasks.filter((task) => task.state === "COMPLETED")
      return {
        kind: "informational",
        title: `${run.runId} is ${progressFor(run)}% complete`,
        lines: [
          `${completed.length} of ${run.tasks.filter((task) => task.mandatory !== false).length} required tasks are completed.`,
          `Outstanding inspections: ${
            run.tasks
              .filter((task) => task.state === "NEEDS_INSPECTION")
              .map((task) => task.name)
              .join(", ") || "none"
          }.`,
        ],
      }
    }
    return {
      kind: "clarifying",
      title: "I need a little more detail",
      lines: [
        "Ask about next work, waiting stages, blockers, completion status, or include an exact run ID.",
      ],
    }
  }

  function ask(value: string) {
    const clean = value.trim()
    if (!clean) {
      setView({
        kind: "clarifying",
        title: "What would you like to know?",
        lines: ["Choose a sample question or enter a production question."],
      })
      return
    }
    setQuery(clean)
    setView({
      kind: "thinking",
      title: "Checking your local demo records…",
      lines: [`Reviewing ${selectedRun.runId} tasks and dependencies.`],
    })
    startThinking(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 450))
      setView(calculate(clean))
    })
  }

  async function runAlexaCommand(value: string) {
    const clean = value.trim()
    setVoiceQuery(clean || voiceQuery)
    if (!clean) {
      setVoiceResult({
        intent: "unknown",
        response: "Alexa needs a question before it can route a command.",
      })
      return
    }

    setVoiceLoading(true)
    setVoiceResult(null)

    const activePending = data.pendingActions.find(
      (p) => p.status === "PENDING",
    )
    const currentRuns = data.runs.length ? (data.runs as ProductionRun[]) : runs
    const currentRun =
      currentRuns.find((r) => r.id === selectedRun.id) ?? selectedRun

    try {
      const response = await fetch("/api/alexa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: clean,
          text: clean,
          deviceId: "cue-dashboard-mock-alexa",
          runId: currentRun.id,
          run: currentRun,
          runs: currentRuns,
          pendingAction: activePending ?? null,
        }),
      })

      const resData = await response.json()
      if (!response.ok || !resData.ok) {
        throw new Error(resData?.error || "The Alexa route was unavailable.")
      }

      setVoiceResult({
        intent: resData.intent ?? "unknown",
        response: resData.response,
        action: resData.action,
      })
    } catch {
      // Graceful fallback to client-side Alexa engine
      const parsed = buildAlexaResponse(clean, {
        run: currentRun,
        runs: currentRuns,
        pendingAction: activePending ?? null,
      })
      setVoiceResult({
        intent: parsed.intent,
        response: parsed.response,
        action: parsed.action,
      })
    } finally {
      setVoiceLoading(false)
    }
  }

  const stateAsset =
    view.kind === "thinking"
      ? "/cue/thinking.png"
      : view.kind === "clarifying"
        ? "/cue/clarifying.png"
        : null

  return (
    <aside className="cue-chat">
      <div className="cue-chat-head">
        <div>
          <strong>Ask CUE</strong>
          <small>
            Uses the same browser demo data as your production board.
          </small>
        </div>
        <img src="/cue/logo.png" alt="CUE assistant" />
      </div>
      <div
        className={`cue-answer cue-answer--${view.kind}`}
        aria-live="polite"
        aria-busy={isThinking}
      >
        {stateAsset && (
          <img
            src={stateAsset}
            alt={
              view.kind === "thinking"
                ? "CUE is thinking"
                : "CUE needs clarification"
            }
          />
        )}
        <div>
          <strong>{view.title}</strong>
          <ul>
            {view.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="cue-suggestions">
        {suggestions.map((suggestion) => (
          <div key={suggestion}>
            <span>{suggestion}</span>
            <button
              type="button"
              disabled={isThinking}
              onClick={() => ask(suggestion)}
            >
              Ask
            </button>
          </div>
        ))}
      </div>
      <div className="cue-voice-panel" style={{ marginTop: "1rem" }}>
        <div className="cue-chat-head" style={{ marginBottom: "0.75rem" }}>
          <div>
            <strong>Alexa voice assistant</strong>
            <small>Mock voice layer connected to the Alexa command API.</small>
          </div>
        </div>
        <div className="cue-suggestions">
          {voiceSuggestions.map((suggestion) => (
            <div key={suggestion}>
              <span>{suggestion}</span>
              <button
                type="button"
                disabled={voiceLoading}
                onClick={() => runAlexaCommand(suggestion)}
              >
                Run
              </button>
            </div>
          ))}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            runAlexaCommand(voiceQuery)
          }}
          style={{ marginTop: "0.75rem" }}
        >
          <label>
            <span className="sr-only">Ask Alexa about production</span>
            <input
              value={voiceQuery}
              onChange={(event) => setVoiceQuery(event.target.value)}
              placeholder="Alexa, what is waiting?"
            />
          </label>
          <button type="submit" disabled={voiceLoading}>
            {voiceLoading ? "Running…" : "Run Alexa"}
          </button>
        </form>
        {voiceResult && (
          <div
            className="cue-voice-result"
            style={{
              marginTop: "0.75rem",
              padding: "0.85rem",
              borderRadius: "0.75rem",
              background: "rgba(124, 58, 237, 0.08)",
              border: "1px solid rgba(124, 58, 237, 0.2)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.35rem",
              }}
            >
              <strong
                style={{
                  fontSize: "0.75rem",
                  letterSpacing: "0.05em",
                  color: "#6d28d9",
                  textTransform: "uppercase",
                }}
              >
                {voiceResult.intent.replace(/_/g, " ")}
              </strong>
              <small style={{ fontSize: "0.7rem", color: "#6b7280" }}>
                Alexa Assistant
              </small>
            </div>
            <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: "1.4" }}>
              {voiceResult.response}
            </p>
            {voiceResult.action?.taskKey && (
              <div style={{ marginTop: "0.5rem" }}>
                <a
                  href={`#task-${voiceResult.action.taskKey}`}
                  className="button button--secondary"
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.25rem 0.5rem",
                    display: "inline-block",
                  }}
                >
                  Locate Task on Board
                </a>
              </div>
            )}
            {voiceResult.action?.type === "confirm" && (
              <div style={{ marginTop: "0.5rem" }}>
                <a
                  href="#confirm-title"
                  className="button button--primary"
                  style={{
                    fontSize: "0.75rem",
                    padding: "0.25rem 0.5rem",
                    display: "inline-block",
                  }}
                >
                  Review Pending Confirmation
                </a>
              </div>
            )}
          </div>
        )}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          ask(query)
        }}
        style={{ marginTop: "1rem" }}
      >
        <label>
          <span className="sr-only">Ask CUE about production</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Ask about ${selectedRun.runId}…`}
          />
        </label>
        <button type="submit" disabled={isThinking}>
          {isThinking ? "Checking…" : "Ask"}
        </button>
      </form>
    </aside>
  )
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
      <CueChat runs={currentRuns} selectedRun={active} />
    </div>
  )
}
