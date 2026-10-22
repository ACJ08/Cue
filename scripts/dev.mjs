import { spawn } from "node:child_process"
import { createRequire } from "node:module"

const require = createRequire(import.meta.url)
const nextCli = require.resolve("next/dist/bin/next")
const port = process.env.PORT || "3000"
const child = spawn(
  process.execPath,
  [nextCli, "dev", "--port", port, "--hostname", "0.0.0.0"],
  { stdio: "inherit", env: process.env },
)
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal))
