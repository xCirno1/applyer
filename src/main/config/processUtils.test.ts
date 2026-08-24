import { describe, it, expect } from 'vitest'
import { runCommand, commandExists } from './processUtils'

describe('runCommand', () => {
  it('captures stdout and a zero exit code on success', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write("hello")'])
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('hello')
    expect(result.stderr).toBe('')
  })

  it('captures stderr and a non-zero exit code on failure', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(2)'])
    expect(result.code).toBe(2)
    expect(result.stderr).toBe('boom')
  })

  it('resolves with code null and an "(timed out)" marker when the command exceeds the timeout', async () => {
    const result = await runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 })
    expect(result.code).toBeNull()
    expect(result.stderr).toContain('(timed out)')
  })

  it('resolves with code null (not a rejected promise) when the command does not exist', async () => {
    const result = await runCommand('applyer-definitely-not-a-real-binary', [])
    expect(result.code).toBeNull()
    expect(result.stderr.length).toBeGreaterThan(0)
  })

  it('runs the child process in the given cwd', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], { cwd: '/tmp' })
    expect(result.code).toBe(0)
    // Resolve symlinks (e.g. macOS /tmp -> /private/tmp) rather than assuming string equality.
    expect(result.stdout.endsWith('tmp')).toBe(true)
  })

  it('passes the given env to the child process', async () => {
    const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.env.APPLYER_TEST_VAR ?? "")'], {
      env: { ...process.env, APPLYER_TEST_VAR: 'hello-env' }
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('hello-env')
  })

  it('streams stdout chunks to onStdout as they arrive, in addition to the buffered result', async () => {
    const chunks: string[] = []
    const result = await runCommand(
      process.execPath,
      ['-e', 'process.stdout.write("a"); process.stdout.write("b")'],
      { onStdout: (chunk) => chunks.push(chunk) }
    )
    expect(result.stdout).toBe('ab')
    expect(chunks.join('')).toBe('ab')
  })
})

describe('commandExists', () => {
  it('is true for a real, working command', async () => {
    await expect(commandExists(process.execPath)).resolves.toBe(true)
  })

  it('is false for a command that is not installed', async () => {
    await expect(commandExists('applyer-definitely-not-a-real-binary')).resolves.toBe(false)
  })
})
