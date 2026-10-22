"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { authenticateDemo } from "@/lib/demo-storage"
import { PasswordField } from "./AuthControls"

export default function AuthForm({ mode }: { mode: "signin" | "signup" }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()

  function submit(formData: FormData) {
    setError("")
    startTransition(async () => {
      const result = authenticateDemo(
        String(formData.get("email") ?? ""),
        String(formData.get("password") ?? ""),
        mode === "signup" ? String(formData.get("name") ?? "") : undefined,
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push("/app")
      router.refresh()
    })
  }

  return (
    <>
      {error && (
        <p className="form-alert" role="alert">
          {error}
        </p>
      )}
      <form action={submit}>
        {mode === "signup" && (
          <label>
            Name
            <input name="name" autoComplete="name" required />
          </label>
        )}
        <label>
          Email address
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <PasswordField
          autoComplete={mode === "signin" ? "current-password" : "new-password"}
          label={mode === "signin" ? "Password" : "Password (8+ characters)"}
        />
        <button
          className="button button--primary"
          type="submit"
          disabled={pending}
        >
          {pending
            ? mode === "signin"
              ? "Signing in…"
              : "Creating account…"
            : mode === "signin"
              ? "Sign in"
              : "Create account"}
        </button>
      </form>
    </>
  )
}
