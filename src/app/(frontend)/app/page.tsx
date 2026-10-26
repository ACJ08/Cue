"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import type { PendingAction, ProductionRun } from "@/lib/demo-types"
import { demoProducts } from "@/lib/demo-data"
import { fetchRuns, proposeTaskUpdate, confirmPendingUpdate } from "@/lib/cue-api"
import DashboardClient from "./DashboardClient"

export default function AppPage() {
  const [runs, setRuns] = useState<ProductionRun[]>([])
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([])
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(true)
  const [userName, setUserName] = useState("Baker Demo")

  const loadData = async () => {
    try {
      const payload = await fetchRuns()
      setRuns(payload.runs)
      setPendingActions(payload.pendingActions ?? [])
      setUserName(payload.user?.name ?? "Baker Demo")
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const pending = pendingActions.find((item) => item.status === "PENDING")
  const runId = pending?.productionRun
  const run = runs.find((item) => item.id === runId)
  const task = run?.tasks.find((item) => item.taskKey === pending?.taskKey)
  const product = run && typeof run.product === "object" ? run.product : undefined

  async function resolve(confirmed: boolean) {
    if (!pending || !run) return
    try {
      const result = await confirmPendingUpdate(run.id, pending.id, confirmed)
      setMessage(
        result.ok
          ? confirmed
            ? `Update confirmed: ${task?.name ?? "task"}.`
            : "Update cancelled. No production task changed."
          : (result as any).error ?? "Unable to finish the update.",
      )
      await loadData()
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  if (loading) {
    return (
      <main className="app-page">
        <p>Opening your CUE workspace…</p>
      </main>
    )
  }

  return (
    <main className="app-page">
      <header className="app-header">
        <Link href="/" className="app-logo">
          <img src="/cue/logo.png" alt="CUE" />
        </Link>
        <div className="app-user">
          <span>
            <strong>{userName}</strong>
            <small>Backend workspace</small>
          </span>
        </div>
      </header>
      <div className="app-shell">
        <div className="app-title">
          <div>
            <p className="eyebrow">Production board · connected to API</p>
            <h1>Good work starts with a clear next step.</h1>
            <p>Updates are validated by the backend before they are applied.</p>
          </div>
          <div className="pending-count">
            <strong>{pendingActions.filter((item) => item.status === "PENDING").length}</strong>
            <span>awaiting confirmation</span>
          </div>
        </div>

        {message && (
          <p
            className={message.startsWith("Update confirmed") ? "operation-banner operation-banner--success" : "form-alert"}
            role="status"
          >
            {message}
          </p>
        )}

        {pending && run && (
          <section className="confirmation-panel" aria-labelledby="confirm-title">
            <div>
              <p className="card-kicker">Review before changing the run</p>
              <h2 id="confirm-title">Confirm this task update?</h2>
              <dl className="confirmation-summary">
                <div>
                  <dt>Production run</dt>
                  <dd>{run.runId}</dd>
                </div>
                <div>
                  <dt>Product</dt>
                  <dd>{product?.name ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Task</dt>
                  <dd>{task?.name ?? pending.taskKey}</dd>
                </div>
                <div>
                  <dt>Proposed state</dt>
                  <dd>{pending.proposedState.replaceAll("_", " ").toLowerCase()}</dd>
                </div>
              </dl>
            </div>
            <div className="confirmation-actions">
              <button className="button button--secondary" onClick={() => void resolve(false)}>
                Cancel
              </button>
              <button className="button button--primary" onClick={() => void resolve(true)}>
                Confirm Update
              </button>
            </div>
          </section>
        )}

        {runs.length ? (
          <DashboardClient runs={runs} pendingActions={pendingActions} onRefresh={loadData} />
        ) : (
          <section className="empty-board">
            <span className="cue-avatar">C</span>
            <h2>Your production board is ready.</h2>
            <p>Choose a product to create your first independent run.</p>
            <div>
              {demoProducts.map((item) => (
                <button className="button button--primary" key={item.id} onClick={async () => {
                  const result = await proposeTaskUpdate(item.id, item.taskDefinitions[0].key, "IN_PROGRESS")
                  void loadData()
                  if (result.ok) {
                    setMessage(`Created a run for ${item.name}.`)
                  }
                }}>
                  {item.name}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
