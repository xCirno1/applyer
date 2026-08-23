import { spawn } from 'child_process'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface RunCommandOptions {
  timeoutMs?: number
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Called with each raw stdout chunk as it arrives, in addition to the buffered `result.stdout` — for streaming progress out of a long-running command. */
  onStdout?: (chunk: string) => void
}

export function runCommand(command: string, args: string[], options: RunCommandOptions = {}): Promise<RunResult> {
  const { timeoutMs = 15000, cwd, env, onStdout } = options
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd, env })
    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        resolve({ code: null, stdout, stderr: stderr + '\n(timed out)' })
      }
    }, timeoutMs)

    child.stdout.on('data', (d: Buffer) => {
      const chunk = d.toString()
      stdout += chunk
      onStdout?.(chunk)
    })
    child.stderr.on('data', (d: Buffer) => (stderr += d.toString()))

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, stdout, stderr: err.message })
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

export async function commandExists(command: string): Promise<boolean> {
  const result = await runCommand(command, ['--version'], { timeoutMs: 8000 })
  return result.code === 0
}
