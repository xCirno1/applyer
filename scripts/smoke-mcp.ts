/**
 * Protocol-level smoke test for the JobHunt MCP tool surface — spawns the
 * same stdio bridge an external CLI (claude/codex) would, connects a real
 * MCP client, lists tools, and calls each with both valid and deliberately
 * invalid input. Requires the JobHunt app to already be running (it's what
 * hosts the actual MCP server on a Unix socket).
 *
 * Usage: tsx scripts/smoke-mcp.ts [--socket <path>]
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { resolve } from 'path'
import { homedir } from 'os'
import { join } from 'path'

function resolveDefaultSocketPath(): string {
  const appName = 'jobhunt'
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', appName, 'mcp.sock')
  }
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\jobhunt-mcp'
  }
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  return join(configHome, appName, 'mcp.sock')
}

function getSocketPathArg(): string {
  const idx = process.argv.indexOf('--socket')
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1]!
  return resolveDefaultSocketPath()
}

let passCount = 0
let failCount = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount++
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } else {
    failCount++
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function main(): Promise<void> {
  const socketPath = getSocketPathArg()
  const bridgeScript = resolve(process.cwd(), 'resources/mcp-bridge.mjs')

  console.log(`Connecting via bridge (socket: ${socketPath})...`)
  const transport = new StdioClientTransport({ command: 'node', args: [bridgeScript, socketPath] })
  const client = new Client({ name: 'jobhunt-smoke-test', version: '0.1.0' })

  try {
    await client.connect(transport)
  } catch (err) {
    console.error(`\nFailed to connect — is the JobHunt app running? (${String(err)})`)
    process.exit(1)
  }

  console.log('\n== tools/list ==')
  const { tools } = await client.listTools()
  const toolNames = tools.map((t) => t.name).sort()
  console.log(`  found: ${toolNames.join(', ')}`)
  const expected = ['flag_failure', 'get_job_details', 'get_profile', 'list_jobs', 'queue_job', 'search_jobs']
  check('all expected tools are registered', expected.every((name) => toolNames.includes(name)))

  console.log('\n== get_profile ==')
  {
    const result = await client.callTool({ name: 'get_profile', arguments: {} })
    check('valid call does not error', !result.isError, JSON.stringify(result.content))
  }

  console.log('\n== list_jobs ==')
  {
    const valid = await client.callTool({ name: 'list_jobs', arguments: { limit: 5 } })
    check('valid call does not error', !valid.isError)

    const invalid = await client.callTool({ name: 'list_jobs', arguments: { limit: 9999 } })
    check('limit above max is rejected cleanly (isError, no crash)', invalid.isError === true)

    const badStatus = await client.callTool({ name: 'list_jobs', arguments: { status: 'not-a-status' } })
    check('invalid status enum is rejected cleanly', badStatus.isError === true)
  }

  console.log('\n== queue_job ==')
  let smokeTestJobId: string | undefined
  {
    const valid = await client.callTool({
      name: 'queue_job',
      arguments: {
        title: '[smoke-test] Example Role',
        company: 'Smoke Test Co',
        url: `https://example.com/smoke-test-job-${Date.now()}`,
        matchScore: 80,
        matchReasons: ['Matches skills', 'Matches location']
      }
    })
    check('valid call does not error', !valid.isError, JSON.stringify(valid.content))
    if (!valid.isError) {
      const text = ((valid.content as { text: string }[])[0] as { text: string }).text
      smokeTestJobId = (JSON.parse(text) as { jobId: string }).jobId
      check('returns a jobId', !!smokeTestJobId)
    }

    const invalid = await client.callTool({
      name: 'queue_job',
      arguments: { title: 'Missing company/url' }
    })
    check('missing required fields rejected cleanly', invalid.isError === true)

    const badUrl = await client.callTool({
      name: 'queue_job',
      arguments: { title: 'x', company: 'y', url: 'not-a-url' }
    })
    check('invalid url rejected cleanly', badUrl.isError === true)
  }

  console.log('\n== flag_failure ==')
  {
    if (smokeTestJobId) {
      const valid = await client.callTool({
        name: 'flag_failure',
        arguments: { jobId: smokeTestJobId, reasonTag: 'other', message: 'smoke test cleanup' }
      })
      check('valid call does not error', !valid.isError, JSON.stringify(valid.content))
    }

    const badTag = await client.callTool({
      name: 'flag_failure',
      arguments: { jobId: smokeTestJobId ?? 'x', reasonTag: 'NOT-VALID-!!' }
    })
    check('invalid reasonTag format rejected cleanly', badTag.isError === true)

    const missingJob = await client.callTool({
      name: 'flag_failure',
      arguments: { jobId: 'does-not-exist', reasonTag: 'other' }
    })
    check('unknown jobId rejected cleanly (not a crash)', missingJob.isError === true)
  }

  console.log('\n== search_jobs (live network) ==')
  {
    const result = await client.callTool({
      name: 'search_jobs',
      arguments: { query: 'software engineer', location: 'remote', sources: ['indeed'], limit: 5 }
    })
    check('valid call does not error', !result.isError, JSON.stringify(result.content))

    const invalid = await client.callTool({ name: 'search_jobs', arguments: { query: '' } })
    check('empty query rejected cleanly', invalid.isError === true)
  }

  console.log('\n== get_job_details (live network) ==')
  {
    const result = await client.callTool({
      name: 'get_job_details',
      arguments: { url: 'https://boards.greenhouse.io/stripe/jobs/8077887' }
    })
    check('valid Greenhouse URL does not error', !result.isError, JSON.stringify(result.content))

    const invalid = await client.callTool({ name: 'get_job_details', arguments: { url: 'not-a-url' } })
    check('invalid url rejected cleanly', invalid.isError === true)
  }

  await client.close()

  console.log(`\n${passCount} passed, ${failCount} failed.`)
  if (smokeTestJobId) {
    console.log(`(left one test job, id=${smokeTestJobId}, in the Failed column — safe to delete from the app.)`)
  }
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Smoke test crashed:', err)
  process.exit(1)
})
