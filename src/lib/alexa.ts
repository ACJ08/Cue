export type AlexaIntent =
  | "status"
  | "next_task"
  | "confirm_update"
  | "inspection"
  | "unknown"

export type AlexaParseResult = {
  intent: AlexaIntent
  normalized: string
  run?: string
  task?: string
  response: string
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

export function parseAlexaIntent(value: string): AlexaParseResult {
  const normalized = normalizeText(value)

  if (!normalized) {
    return {
      intent: "unknown",
      normalized,
      response: "I’m ready to help with a production run, but I need a clear question.",
    }
  }

  const runMatch = normalized.match(/(?:for|of|on)\s+([a-z0-9][a-z0-9 -]{1,40})/i)
  const taskMatch = normalized.match(/(?:task|step|item|batch)\s+(?:named\s+)?([a-z0-9][a-z0-9 -]{1,40})/i)

  if (/what.*(status|progress)|status.*(run|order)|report.*status/.test(normalized)) {
    return {
      intent: "status",
      normalized,
      run: runMatch?.[1]?.trim(),
      response: `Status check requested${runMatch?.[1] ? ` for ${runMatch[1]}` : ""}. CUE can read the recorded workflow state and return completed, waiting, and blocked tasks.`,
    }
  }

  if (/what.*(next|eligible)|next.*(task|step)|what.*(should.*do|can.*do)/.test(normalized)) {
    return {
      intent: "next_task",
      normalized,
      run: runMatch?.[1]?.trim(),
      response: `Next-task guidance requested${runMatch?.[1] ? ` for ${runMatch[1]}` : ""}. CUE can identify the next eligible task based on prerequisites and required checks.`,
    }
  }

  if (/confirm|mark .* complete|finished|inspection|quality check/.test(normalized)) {
    return {
      intent: "confirm_update",
      normalized,
      task: taskMatch?.[1]?.trim(),
      response: `Update confirmation requested${taskMatch?.[1] ? ` for ${taskMatch[1]}` : ""}. CUE should ask for confirmation before writing the new state to the production board.`,
    }
  }

  if (/inspection|check.*ready|quality.*pass|failed.*inspection/.test(normalized)) {
    return {
      intent: "inspection",
      normalized,
      task: taskMatch?.[1]?.trim(),
      response: `Inspection flow requested${taskMatch?.[1] ? ` for ${taskMatch[1]}` : ""}. CUE should verify the required human check before allowing the task to complete.`,
    }
  }

  return {
    intent: "unknown",
    normalized,
    response: "CUE heard a request, but it does not match a known Alexa intent yet. Try asking for the run status, the next eligible task, or a task confirmation.",
  }
}

export function buildAlexaResponse(input: string) {
  const parsed = parseAlexaIntent(input)
  return {
    ...parsed,
    cardTitle: "Alexa + CUE Integration",
    cardText: parsed.response,
  }
}
