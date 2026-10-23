export type CueApiRunState = {
  runs: any[]
  user: any
  pendingActions: any[]
}

export async function fetchRuns(): Promise<CueApiRunState> {
  const response = await fetch("/api/runs", { cache: "no-store" })
  if (!response.ok) {
    throw new Error("Failed to load runs")
  }
  return response.json() as Promise<CueApiRunState>
}

export async function proposeTaskUpdate(
  runId: string,
  taskKey: string,
  nextState: string,
  reason = "",
  actionType = "transition",
) {
  const response = await fetch(`/api/runs/${runId}/propose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskKey, nextState, reason, actionType }),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(json.error ?? "Failed to propose update")
  }
  return json
}

export async function confirmPendingUpdate(
  runId: string,
  pendingId: string,
  confirm = true,
) {
  const response = await fetch(`/api/runs/${runId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pendingId, confirm }),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(json.error ?? "Failed to confirm update")
  }
  return json
}
