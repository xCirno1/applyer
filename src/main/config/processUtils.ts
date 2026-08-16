import { spawn } from 'child_process'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

export function runCommand(command: string, args: string[], timeoutMs = 15000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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

    child.stdout.on('data', (d: Buffer) => (stdout += d.toString()))
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
  const result = await runCommand(command, ['--version'], 8000)
  return result.code === 0
}
