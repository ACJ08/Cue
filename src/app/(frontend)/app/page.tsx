import Link from "next/link"
import { redirect } from "next/navigation"
import type { PendingAction, ProductionRun } from "@/payload-types"
import { appAuth } from "@/lib/app-auth"
import { getPayloadClient } from "@/lib/payload"
import DashboardClient from "./DashboardClient"
import { cancelAction, confirmAction, createRun, signOut } from "./actions"
import PendingButton from "./PendingButton"

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<{
    pending?: string
    error?: string
    success?: string
    cancelled?: string
  }>
}) {
  const user = await appAuth.currentUser()
  if (!user) redirect("/auth/signin")
  const payload = await getPayloadClient()
  const authUser = { ...user, collection: "users" as const }
  const [{ docs: runs }, { docs: products }, { docs: pendingActions }] =
    await Promise.all([
      payload.find({
        collection: "production-runs",
        depth: 1,
        limit: 50,
        sort: "-updatedAt",
        user: authUser,
        overrideAccess: false,
      }),
      payload.find({
        collection: "products",
        depth: 0,
        limit: 10,
        sort: "name",
        user: authUser,
        overrideAccess: false,
      }),
      payload.find({
        collection: "pending-actions",
        depth: 1,
        limit: 50,
        sort: "-createdAt",
        where: { status: { equals: "PENDING" } },
        user: authUser,
        overrideAccess: false,
      }),
    ])
  const params = await searchParams
  const selectedPending = (
    params.pending
      ? pendingActions.find((item) => item.id === params.pending)
      : pendingActions[0]
  ) as PendingAction | undefined
  const pendingRun = selectedPending
    ? (runs as ProductionRun[]).find((run) => {
        const relationship = selectedPending.productionRun
        return (
          run.id ===
          (typeof relationship === "object" ? relationship.id : relationship)
        )
      })
    : undefined
  const pendingTask = pendingRun?.tasks.find(
    (task) => task.taskKey === selectedPending?.taskKey,
  )

  return (
    <main className="app-page">
      <header className="app-header">
        <Link href="/" className="app-logo">
          <img src="/cue/logo.png" alt="CUE" />
        </Link>
        <div className="app-user">
          <span>
            <strong>{user.name}</strong>
            <small>
              {user.accountType === "demo"
                ? "Isolated demo workspace"
                : "Baker workspace"}
            </small>
          </span>
          <form action={signOut}>
            <PendingButton pendingLabel="Signing out…">Sign out</PendingButton>
          </form>
        </div>
      </header>
      <div className="app-shell">
        <div className="app-title">
          <div>
            <p className="eyebrow">Live production</p>
            <h1>Good work starts with a clear next step.</h1>
            <p>
              Every status below comes from your owned Payload production
              records.
            </p>
          </div>
          <div className="pending-count">
            <strong>{pendingActions.length}</strong>
            <span>awaiting confirmation</span>
          </div>
        </div>
        {params.error && (
          <p className="form-alert" role="alert">
            {params.error}
          </p>
        )}
        {params.success && (
          <div
            className="operation-banner operation-banner--success"
            role="status"
          >
            <img src="/cue/success.png" alt="" />
            <div>
              <strong>Update confirmed</strong>
              <span>
                {params.success} now reflects the authoritative production
                record.
              </span>
            </div>
          </div>
        )}
        {params.cancelled && (
          <div className="operation-banner" role="status">
            <strong>Update cancelled</strong>
            <span>No production task or dependent state was changed.</span>
          </div>
        )}
        {selectedPending && (
          <section
            className="confirmation-panel"
            aria-labelledby="confirm-title"
          >
            <div>
              <p className="card-kicker">Review before changing the run</p>
              <h2 id="confirm-title">Confirm this task update?</h2>
              <dl className="confirmation-summary">
                <div>
                  <dt>Production run</dt>
                  <dd>{pendingRun?.runId ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Product</dt>
                  <dd>
                    {pendingRun && typeof pendingRun.product === "object"
                      ? pendingRun.product.name
                      : "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Task</dt>
                  <dd>
                    {pendingTask?.name ??
                      selectedPending.taskKey.replaceAll("-", " ")}
                  </dd>
                </div>
                <div>
                  <dt>Current state</dt>
                  <dd>
                    {selectedPending.expectedState
                      .replaceAll("_", " ")
                      .toLowerCase()}
                  </dd>
                </div>
                <div>
                  <dt>Proposed state</dt>
                  <dd>
                    {selectedPending.proposedState
                      .replaceAll("_", " ")
                      .toLowerCase()}
                  </dd>
                </div>
              </dl>
              {selectedPending.actionType === "inspection" && (
                <p className="inspection-question">
                  Have you physically verified the required condition for this
                  task?
                </p>
              )}
            </div>
            <div className="confirmation-actions">
              <form action={cancelAction}>
                <input
                  type="hidden"
                  name="pendingId"
                  value={selectedPending.id}
                />
                <PendingButton
                  className="button button--secondary"
                  pendingLabel="Cancelling…"
                >
                  Cancel
                </PendingButton>
              </form>
              <form action={confirmAction}>
                <input
                  type="hidden"
                  name="pendingId"
                  value={selectedPending.id}
                />
                <PendingButton
                  className="button button--primary"
                  pendingLabel="Applying…"
                >
                  {selectedPending.actionType === "inspection"
                    ? "Confirm After Inspection"
                    : "Confirm Update"}
                </PendingButton>
              </form>
            </div>
          </section>
        )}
        {runs.length ? (
          <DashboardClient runs={runs as ProductionRun[]} />
        ) : (
          <section className="empty-board">
            <span className="cue-avatar">C</span>
            <h2>Your production board is ready.</h2>
            <p>
              Choose an authoritative template to create your first independent
              run.
            </p>
            <div>
              {products.map((product) => (
                <form action={createRun} key={product.id}>
                  <input type="hidden" name="productId" value={product.id} />
                  <PendingButton pendingLabel="Creating…">
                    {product.name}
                  </PendingButton>
                </form>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
