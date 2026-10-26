import assert from "node:assert/strict"
import test from "node:test"
import { parseAlexaIntent, buildAlexaResponse } from "../src/lib/alexa.ts"
import { createInitialDemoState } from "../src/lib/demo-data.ts"

const initial = createInitialDemoState()
const sampleRun = initial.runs[0] // DEMO-HIO (Pistachio)
const samplePending = initial.pendingActions[0]

test("parses status intent and calculates real run progress", () => {
  const result = parseAlexaIntent("Alexa, what is the status of DEMO-HIO?", {
    run: sampleRun,
    runs: initial.runs,
  })
  assert.equal(result.intent, "status")
  assert.match(result.response, /43% complete/i)
  assert.match(result.response, /3 of 7 required tasks/i)
  assert.match(result.response, /cooling/i)
})

test("identifies waiting stage with start time, duration, and inspection requirement", () => {
  const result = parseAlexaIntent("Alexa, what is waiting?", {
    run: sampleRun,
    runs: initial.runs,
  })
  assert.equal(result.intent, "waiting")
  assert.match(result.response, /Cool the main component/i)
  assert.match(result.response, /45 minutes/i)
  assert.match(result.response, /physical inspection is required/i)
  assert.match(result.response, /Prepare packaging/i) // Parallel work mention
})

test("guides next eligible task while accounting for active and waiting stages", () => {
  const result = parseAlexaIntent("Alexa, what can I do next?", {
    run: sampleRun,
    runs: initial.runs,
  })
  assert.equal(result.intent, "next_task")
  assert.match(result.response, /Prepare packaging.*in progress/i)
})

test("detects inspection intent and attaches action metadata", () => {
  const result = parseAlexaIntent("Alexa, mark the inspection complete", {
    run: sampleRun,
    runs: initial.runs,
  })
  assert.equal(result.intent, "inspection")
  assert.equal(result.taskKey, "cool-main")
  assert.equal(result.action?.type, "inspection")
  assert.match(result.response, /physical check is required/i)
})

test("detects update confirmation and references board safety guard", () => {
  const result = parseAlexaIntent("Alexa, confirm update", {
    run: sampleRun,
    runs: initial.runs,
    pendingAction: samplePending,
  })
  assert.equal(result.intent, "confirm_update")
  assert.equal(result.action?.type, "confirm")
  assert.match(result.response, /Prepare packaging/i)
})

test("detects cancel intent for pending proposals", () => {
  const result = parseAlexaIntent("Alexa, cancel update", {
    run: sampleRun,
    runs: initial.runs,
    pendingAction: samplePending,
  })
  assert.equal(result.intent, "cancel_update")
  assert.equal(result.action?.type, "cancel")
  assert.match(result.response, /cancel the proposed update/i)
})

test("handles blocker inquiries for blocked runs", () => {
  const blockedRun = initial.runs[2] // DEMO-KIE / Cookies has cook-main BLOCKED
  const result = parseAlexaIntent("Alexa, why is it blocked?", {
    run: blockedRun,
    runs: initial.runs,
  })
  assert.equal(result.intent, "blocked")
  assert.match(result.response, /Cook or bake the main component/i)
})

test("falls back gracefully on unknown commands", () => {
  const result = parseAlexaIntent("Alexa, make me coffee", {
    run: sampleRun,
    runs: initial.runs,
  })
  assert.equal(result.intent, "unknown")
  assert.match(result.response, /did not match a known command/i)
})

test("buildAlexaResponse wraps result with card details", () => {
  const result = buildAlexaResponse("Alexa, what is waiting?", {
    run: sampleRun,
    runs: initial.runs,
  })
  assert.ok(result.cardTitle)
  assert.ok(result.cardText)
  assert.equal(result.intent, "waiting")
})
