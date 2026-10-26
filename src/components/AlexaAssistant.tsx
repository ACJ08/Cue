"use client"

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react"
import type { AlexaAction, AlexaIntent } from "@/lib/alexa"
import { buildAlexaResponse, getDynamicSuggestions } from "@/lib/alexa"
import type { ProductionRun, PendingAction } from "@/lib/demo-types"
import {
  useDemoState,
  transitionRun,
  confirmPending,
} from "@/lib/demo-storage"
import { productName, progressFor } from "@/lib/workflow"

export interface AlexaMessage {
  id: string
  role: "user" | "alexa"
  text: string
  intent?: AlexaIntent
  cardTitle?: string
  cardText?: string
  action?: AlexaAction
  timestamp: number
}

// Web Audio API smart speaker chime
function playTone(freq1 = 523.25, freq2 = 659.25, duration = 0.12) {
  if (typeof window === "undefined") return
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()

    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = "sine"
    osc1.frequency.setValueAtTime(freq1, ctx.currentTime)
    gain1.gain.setValueAtTime(0.08, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + duration)

    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = "sine"
    osc2.frequency.setValueAtTime(freq2, ctx.currentTime + duration * 0.75)
    gain2.gain.setValueAtTime(0.08, ctx.currentTime + duration * 0.75)
    gain2.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + duration * 1.75,
    )
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(ctx.currentTime + duration * 0.75)
    osc2.stop(ctx.currentTime + duration * 1.75)
  } catch {
    // AudioContext blocked or unavailable
  }
}

export default function AlexaAssistant() {
  const { state: data } = useDemoState()
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<AlexaMessage[]>([
    {
      id: "initial-alexa-greeting",
      role: "alexa",
      text: "Hello! I am your CUE Alexa voice assistant. Ask me about your baking workflow, active waits, eligible tasks, or inspection checks.",
      cardTitle: "Alexa + CUE Assistant",
      cardText: "Say 'What can I do next?' or select a quick voice prompt below.",
      intent: "help",
      timestamp: Date.now(),
    },
  ])
  const [inputValue, setInputValue] = useState("")
  const [interimText, setInterimText] = useState("")
  const [isThinking, setIsThinking] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [speechEnabled, setSpeechEnabled] = useState(true)
  const [selectedRunId, setSelectedRunId] = useState<string>("")

  const scrollRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)

  // Active run resolution from live demo state
  const activeRun = useMemo<ProductionRun | undefined>(() => {
    if (!data.runs.length) return undefined
    return data.runs.find((r) => r.id === selectedRunId) ?? data.runs[0]
  }, [data.runs, selectedRunId])

  const activePending = useMemo<PendingAction | null>(() => {
    return (
      data.pendingActions.find((p) => p.status === "PENDING") ?? null
    )
  }, [data.pendingActions])

  // Sync with dashboard run selection events
  useEffect(() => {
    function handleSelectRun(e: Event) {
      const customEvent = e as CustomEvent<{ runId: string }>
      if (customEvent.detail?.runId) {
        setSelectedRunId(customEvent.detail.runId)
      }
    }
    window.addEventListener("cue:select-run", handleSelectRun)
    return () => {
      window.removeEventListener("cue:select-run", handleSelectRun)
    }
  }, [])

  // Dynamic context-aware voice prompts
  const suggestions = useMemo(() => {
    return getDynamicSuggestions(activeRun, activePending, data.runs)
  }, [activeRun, activePending, data.runs])

  // Auto-scroll to bottom of chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isOpen, isThinking, interimText])

  // Text-to-Speech function
  const speakText = useCallback(
    (text: string) => {
      if (
        !speechEnabled ||
        typeof window === "undefined" ||
        !("speechSynthesis" in window)
      ) {
        return
      }
      try {
        window.speechSynthesis.cancel()
        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = 1.05
        utterance.pitch = 1.0

        utterance.onstart = () => setIsSpeaking(true)
        utterance.onend = () => setIsSpeaking(false)
        utterance.onerror = () => setIsSpeaking(false)

        const voices = window.speechSynthesis.getVoices()
        const alexaVoice = voices.find(
          (v) =>
            v.lang.startsWith("en") &&
            (v.name.includes("Samantha") ||
              v.name.includes("Google UK English Female") ||
              v.name.includes("Victoria") ||
              v.name.includes("Zira") ||
              v.name.includes("Natural")),
        )
        if (alexaVoice) utterance.voice = alexaVoice
        window.speechSynthesis.speak(utterance)
      } catch {
        setIsSpeaking(false)
      }
    },
    [speechEnabled],
  )

  // Speech Recognition (Mic input) with Live Interim Transcription
  const toggleListening = () => {
    if (typeof window === "undefined") return

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition

    if (!SpeechRecognition) {
      alert(
        "Speech recognition is not supported in this browser. You can type commands directly into the prompt.",
      )
      return
    }

    if (isListening) {
      recognitionRef.current?.stop()
      setIsListening(false)
      setInterimText("")
      return
    }

    try {
      playTone(523.25, 659.25) // Alexa chime on mic activation
      const recognition = new SpeechRecognition()
      recognitionRef.current = recognition
      recognition.lang = "en-US"
      recognition.interimResults = true
      recognition.maxAlternatives = 1

      recognition.onstart = () => {
        setIsListening(true)
        setInterimText("")
      }

      recognition.onresult = (event: any) => {
        let currentInterim = ""
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const transcript = event.results[i][0].transcript
            setIsListening(false)
            setInterimText("")
            if (transcript) {
              setInputValue(transcript)
              handleSend(transcript)
            }
            return
          } else {
            currentInterim += event.results[i][0].transcript
          }
        }
        setInterimText(currentInterim)
      }

      recognition.onerror = () => {
        setIsListening(false)
        setInterimText("")
      }

      recognition.onend = () => {
        setIsListening(false)
        setInterimText("")
      }

      recognition.start()
    } catch {
      setIsListening(false)
      setInterimText("")
    }
  }

  // Handle action button clicks (Confirm, Cancel, Inspection, Transition, Switch Run)
  const handleExecuteAction = (action?: AlexaAction) => {
    if (!action) return

    if (action.type === "confirm") {
      const pending = data.pendingActions.find((p) => p.status === "PENDING")
      const idToConfirm = action.pendingActionId ?? pending?.id
      if (idToConfirm) {
        const result = confirmPending(idToConfirm, true)
        if (result.ok) {
          playTone(587.33, 880) // Success chime
          const text = "Proposal confirmed! The production board has been updated."
          setMessages((prev) => [
            ...prev,
            {
              id: `confirm-ack-${Date.now()}`,
              role: "alexa",
              text,
              cardTitle: "Update Confirmed",
              cardText: "Task transition applied to the batch successfully.",
              timestamp: Date.now(),
            },
          ])
          speakText(text)
        }
      }
    } else if (action.type === "cancel") {
      const pending = data.pendingActions.find((p) => p.status === "PENDING")
      const idToCancel = action.pendingActionId ?? pending?.id
      if (idToCancel) {
        confirmPending(idToCancel, false)
        const text = "Proposal cancelled. The batch state remains unchanged."
        setMessages((prev) => [
          ...prev,
          {
            id: `cancel-ack-${Date.now()}`,
            role: "alexa",
            text,
            timestamp: Date.now(),
          },
        ])
        speakText(text)
      }
    } else if (
      action.type === "inspection" &&
      action.runId &&
      action.taskKey
    ) {
      const result = transitionRun(
        action.runId,
        action.taskKey,
        "COMPLETED",
        "Physical inspection signed off",
        "inspection",
      )
      if (result.ok) {
        playTone(587.33, 880)
        const text = `Inspection verified for ${action.taskKey}. Please confirm the proposal to finalize.`
        setMessages((prev) => [
          ...prev,
          {
            id: `inspect-ack-${Date.now()}`,
            role: "alexa",
            text,
            action: {
              type: "confirm",
              runId: action.runId,
              taskKey: action.taskKey,
            },
            timestamp: Date.now(),
          },
        ])
        speakText(text)
      }
    } else if (
      action.type === "transition" &&
      action.runId &&
      action.taskKey &&
      action.targetState
    ) {
      const result = transitionRun(
        action.runId,
        action.taskKey,
        action.targetState,
        "Voice command transition",
        "transition",
      )
      if (result.ok) {
        playTone(587.33, 880)
        const text = `Proposal registered to move ${action.taskKey} to ${action.targetState.toLowerCase().replace(/_/g, " ")}. Confirm to apply.`
        setMessages((prev) => [
          ...prev,
          {
            id: `trans-ack-${Date.now()}`,
            role: "alexa",
            text,
            action: {
              type: "confirm",
              runId: action.runId,
              taskKey: action.taskKey,
            },
            timestamp: Date.now(),
          },
        ])
        speakText(text)
      }
    } else if (action.type === "switch_run" && action.runId) {
      setSelectedRunId(action.runId)
      window.dispatchEvent(
        new CustomEvent("cue:select-run", { detail: { runId: action.runId } }),
      )
    }
  }

  // Handle sending a voice or text command to Alexa
  const handleSend = async (overrideText?: string) => {
    const textToSend = (overrideText ?? inputValue).trim()
    if (!textToSend || isThinking) return

    const userMessage: AlexaMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: textToSend,
      timestamp: Date.now(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInputValue("")
    setInterimText("")
    setIsThinking(true)

    const workspaceContext = {
      activeRun,
      runs: data.runs,
      pendingAction: activePending,
    }

    try {
      const res = await fetch("/api/alexa/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: textToSend,
          text: textToSend,
          deviceId: "cue-alexa-concierge-web",
          runId: workspaceContext.activeRun?.id,
          run: workspaceContext.activeRun,
          runs: workspaceContext.runs,
          pendingAction: workspaceContext.pendingAction,
        }),
      })

      const resData = await res.json()

      if (!res.ok || !resData.ok) {
        throw new Error(resData?.error || "Alexa route returned an error.")
      }

      // If action is switch_run, auto-dispatch selection to dashboard
      if (resData.action?.type === "switch_run" && resData.action.runId) {
        setSelectedRunId(resData.action.runId)
        window.dispatchEvent(
          new CustomEvent("cue:select-run", {
            detail: { runId: resData.action.runId },
          }),
        )
      }

      const alexaMessage: AlexaMessage = {
        id: `alexa-${Date.now()}`,
        role: "alexa",
        text: resData.response,
        intent: resData.intent,
        cardTitle: resData.cardTitle,
        cardText: resData.cardText,
        action: resData.action,
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, alexaMessage])
      speakText(resData.response)
    } catch {
      // Graceful local fallback via client-side alexa engine
      const fallback = buildAlexaResponse(textToSend, {
        run: workspaceContext.activeRun,
        runs: workspaceContext.runs,
        pendingAction: workspaceContext.pendingAction,
      })

      if (fallback.action?.type === "switch_run" && fallback.action.runId) {
        setSelectedRunId(fallback.action.runId)
        window.dispatchEvent(
          new CustomEvent("cue:select-run", {
            detail: { runId: fallback.action.runId },
          }),
        )
      }

      const alexaMessage: AlexaMessage = {
        id: `alexa-${Date.now()}`,
        role: "alexa",
        text: fallback.response,
        intent: fallback.intent,
        cardTitle: fallback.cardTitle,
        cardText: fallback.cardText,
        action: fallback.action,
        timestamp: Date.now(),
      }

      setMessages((prev) => [...prev, alexaMessage])
      speakText(fallback.response)
    } finally {
      setIsThinking(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end font-sans">
      {/* Floating Concierge Window (Aura-inspired) */}
      {isOpen && (
        <div className="cue-alexa-window mb-4 flex w-[94vw] max-w-[430px] h-[610px] flex-col overflow-hidden rounded-3xl border border-[#e7def0] bg-white shadow-2xl shadow-purple-950/20 backdrop-blur-xl transition-all duration-300">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#ebdff5] bg-gradient-to-r from-[#260b48] via-[#32105b] to-[#4c1785] px-5 py-4 text-white">
            <div className="flex items-center gap-3">
              <div className="relative flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10 shadow-inner">
                {/* Alexa Wave Echo Icon */}
                <svg
                  className="h-5 w-5 text-purple-200"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
                <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                </span>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-extrabold tracking-tight text-white font-['Manrope']">
                    Alexa Voice Concierge
                  </h3>
                  {/* Equalizer animation when speaking or listening */}
                  {(isListening || isSpeaking) && (
                    <div className="flex items-center gap-0.5">
                      <span className="h-3 w-0.5 animate-pulse rounded-full bg-emerald-400" />
                      <span className="h-4 w-0.5 animate-pulse rounded-full bg-emerald-400 [animation-delay:0.15s]" />
                      <span className="h-2 w-0.5 animate-pulse rounded-full bg-emerald-400 [animation-delay:0.3s]" />
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-purple-200/80">
                  {activeRun ? (
                    <>
                      <span className="font-semibold">{activeRun.runId}</span> (
                      {productName(activeRun)}) • {progressFor(activeRun)}%
                    </>
                  ) : (
                    "CUE Kitchen Assistant"
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {/* Text-to-Speech Toggle */}
              <button
                type="button"
                onClick={() => setSpeechEnabled(!speechEnabled)}
                title={
                  speechEnabled
                    ? "Mute Alexa voice output"
                    : "Enable Alexa voice output"
                }
                className={`rounded-xl p-2 transition-colors ${
                  speechEnabled
                    ? "bg-purple-700/60 text-purple-100 hover:bg-purple-700"
                    : "text-purple-300 hover:bg-white/10"
                }`}
              >
                {speechEnabled ? (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                  </svg>
                ) : (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"
                    />
                  </svg>
                )}
              </button>

              {/* Close Button */}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-xl p-2 text-purple-200 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close Assistant"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Chat Messages Area */}
          <div
            ref={scrollRef}
            className="flex-1 space-y-4 overflow-y-auto bg-[#faf7fc] p-4"
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl p-4 text-xs leading-relaxed shadow-sm transition-all ${
                    msg.role === "user"
                      ? "bg-gradient-to-r from-[#6730b8] to-[#32105b] text-white rounded-br-sm"
                      : "border border-[#e9e1f2] bg-white text-[#21162d] rounded-bl-sm"
                  }`}
                >
                  {/* Alexa intent badge */}
                  {msg.role === "alexa" && msg.intent && (
                    <div className="mb-2 flex items-center justify-between gap-2 border-b border-[#f2ebf7] pb-1.5">
                      <span className="inline-flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-wider text-[#7a42cc]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#7a42cc]"></span>
                        {msg.intent.replace(/_/g, " ")}
                      </span>
                      <button
                        type="button"
                        onClick={() => speakText(msg.text)}
                        title="Replay speech"
                        className="text-[#a98aeb] hover:text-[#6730b8]"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                          />
                        </svg>
                      </button>
                    </div>
                  )}

                  <p className="font-normal">{msg.text}</p>

                  {/* Alexa Skill Card (Echo Show / App Card) */}
                  {msg.cardTitle && msg.cardTitle !== "Alexa + CUE Assistant" && (
                    <div className="mt-3 rounded-xl border border-purple-100 bg-[#f8f4ff] p-2.5 text-[11px] text-[#4c1785]">
                      <div className="flex items-center gap-1.5 font-bold">
                        <svg
                          className="h-3 w-3 text-[#7a42cc]"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <rect
                            x="2"
                            y="3"
                            width="20"
                            height="14"
                            rx="2"
                            strokeWidth="2"
                          />
                          <line x1="8" y1="21" x2="16" y2="21" strokeWidth="2" />
                          <line x1="12" y1="17" x2="12" y2="21" strokeWidth="2" />
                        </svg>
                        <span>{msg.cardTitle}</span>
                      </div>
                      <div className="mt-1 whitespace-pre-line text-[#54495e]">
                        {msg.cardText}
                      </div>
                    </div>
                  )}

                  {/* Interactive Action Execution Buttons */}
                  {msg.action && (
                    <div className="mt-3 flex flex-wrap gap-2 pt-1 border-t border-purple-100">
                      {msg.action.type === "confirm" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction(msg.action)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 px-3 py-1.5 text-[11px] font-bold text-white shadow-md shadow-emerald-700/20 transition-all hover:opacity-90 active:scale-95"
                        >
                          <span>⚡ Confirm Update</span>
                        </button>
                      )}
                      {msg.action.type === "cancel" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction(msg.action)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-bold text-rose-700 transition-all hover:bg-rose-100 active:scale-95"
                        >
                          <span>✕ Cancel Proposal</span>
                        </button>
                      )}
                      {msg.action.type === "inspection" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction(msg.action)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#6730b8] to-[#4c1785] px-3 py-1.5 text-[11px] font-bold text-white shadow-md shadow-purple-900/20 transition-all hover:opacity-90 active:scale-95"
                        >
                          <span>🔍 Confirm Physical Inspection</span>
                        </button>
                      )}
                      {msg.action.type === "transition" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction(msg.action)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-[#6730b8] to-[#32105b] px-3 py-1.5 text-[11px] font-bold text-white shadow-md shadow-purple-900/20 transition-all hover:opacity-90 active:scale-95"
                        >
                          <span>⚡ Propose Transition</span>
                        </button>
                      )}
                      {msg.action.type === "switch_run" && (
                        <button
                          type="button"
                          onClick={() => handleExecuteAction(msg.action)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-purple-50 px-3 py-1.5 text-[11px] font-bold text-[#4c1785] transition-all hover:bg-purple-100 active:scale-95"
                        >
                          <span>📋 View Batch on Board</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <span className="mt-1 px-1 text-[9px] text-[#9d92a8]">
                  {new Date(msg.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))}

            {/* Aura-style Bouncing Dots Thinking Indicator */}
            {isThinking && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm border border-[#e9e1f2] bg-white px-4 py-3 shadow-sm">
                  <span className="text-[10px] font-semibold text-[#7a42cc] mr-1">
                    Alexa is consulting CUE
                  </span>
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7a42cc]"></div>
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7a42cc] [animation-delay:0.15s]"></div>
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#7a42cc] [animation-delay:0.3s]"></div>
                </div>
              </div>
            )}
          </div>

          {/* Quick Voice Suggestions Chips (Dynamic & Context-Aware) */}
          <div className="border-t border-[#ebdff5] bg-white px-3 py-2">
            <div className="flex gap-1.5 overflow-x-auto pb-1 text-[10px] no-scrollbar">
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => handleSend(suggestion)}
                  disabled={isThinking}
                  className="flex-shrink-0 rounded-full border border-[#ebdff5] bg-[#f8f4ff] px-2.5 py-1 font-medium text-[#4c1785] transition-colors hover:border-[#a98aeb] hover:bg-[#ebdff5] disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>

          {/* Input & Voice Controls */}
          <div className="border-t border-[#ebdff5] bg-[#faf7fc] p-3">
            {/* Interim Transcription Live Preview */}
            {isListening && (
              <div className="mb-2 flex items-center gap-2 rounded-xl bg-purple-900/90 px-3 py-1.5 text-xs text-white shadow-md backdrop-blur-md">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-medium truncate">
                  {interimText ? `"${interimText}"` : "Listening to your voice..."}
                </span>
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* Mic Button (Speech-to-Text with chime) */}
              <button
                type="button"
                onClick={toggleListening}
                title={
                  isListening
                    ? "Listening... click to stop"
                    : "Speak to Alexa (Click to activate mic)"
                }
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl transition-all ${
                  isListening
                    ? "animate-pulse bg-rose-600 text-white shadow-lg shadow-rose-500/30 ring-2 ring-rose-400"
                    : "border border-[#e7def0] bg-white text-[#6730b8] hover:bg-[#eee6fc]"
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                  />
                </svg>
              </button>

              {/* Text Input */}
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  isListening
                    ? "Listening to voice..."
                    : activeRun
                      ? `Ask Alexa about ${activeRun.runId}…`
                      : "Ask Alexa (e.g. What is waiting?)..."
                }
                className="flex-1 rounded-2xl border border-[#e7def0] bg-white px-3.5 py-2.5 text-xs text-[#21162d] outline-none transition-colors placeholder:text-[#a98aeb] focus:border-[#7a42cc] focus:ring-1 focus:ring-[#7a42cc]"
              />

              {/* Send Button */}
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || isThinking}
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-[#6730b8] to-[#32105b] text-white shadow-md shadow-purple-900/20 transition-all hover:opacity-90 disabled:opacity-40"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Button (Aura-style) */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-r from-[#6730b8] via-[#4c1785] to-[#260b48] text-white shadow-xl shadow-purple-900/30 transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-purple-900/50"
        aria-label="Toggle Alexa Concierge"
      >
        {isOpen ? (
          <svg
            className="h-6 w-6 transition-transform duration-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M19.5 8.25l-7.5 7.5-7.5-7.5"
            />
          </svg>
        ) : (
          <div className="relative flex items-center justify-center">
            {/* Alexa Voice Microphone / Echo Icon */}
            <svg
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="22" />
            </svg>
            {/* Pulsing Aura Badge */}
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
            </span>
          </div>
        )}

        {/* Hover Tooltip when closed */}
        {!isOpen && (
          <span className="pointer-events-none absolute right-16 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-xl border border-purple-200 bg-white px-3 py-1.5 text-xs font-bold text-[#32105b] opacity-0 shadow-lg transition-opacity duration-200 group-hover:opacity-100">
            🎙️ Ask Alexa + CUE
          </span>
        )}
      </button>
    </div>
  )
}
