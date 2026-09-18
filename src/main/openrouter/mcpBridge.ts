import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { APP_VERSION } from '@shared/version'
import { createApplyerMcpServer } from '../mcp-server/server'
import { appLogger } from '../logger'
import type { OpenAiTool } from './streamChat'

/**
 * The agent runner talks to Applyer's own MCP tools exactly the way an
 * external CLI agent does over stdio, just without the process boundary:
 * one `McpServer` (the same `createApplyerMcpServer()` the CLI bridge
 * spawns) and one SDK `Client` wired together with `InMemoryTransport`
 * rather than a socket, so every tool call still goes through the SDK's own
 * request/response and schema plumbing (and `observed()`'s run-event
 * recording in `server.ts`) instead of calling a tool's handler directly.
 *
 * The pair is created lazily, on the first call from either
 * `listToolDefinitions` or `callTool`, and kept for the process lifetime:
 * a second chat turn (or a second session) reuses the same connection
 * rather than paying MCP's initialize handshake again. There is exactly one
 * of these for the whole app, mirroring the CLI bridge which also serves
 * every terminal session over the same socket.
 *
 * `listToolDefinitions` is cached after its first successful call for the
 * same reason `modelCatalog.ts` caches the model list: the tool set only
 * changes when Applyer itself ships a new build, never at runtime, and the
 * agent loop asks for it on every turn.
 *
 * `callTool` never throws. A thrown MCP/transport error (a malformed
 * argument the tool's own zod schema rejected, a disconnected transport)
 * becomes an `isError: true` result carrying the message, the same shape a
 * tool's own handler uses for a recoverable failure, so the model always
 * gets something it can read and react to, and a bad tool call from the
 * model can never crash the turn.
 */

let clientPromise: Promise<Client> | null = null
let toolDefinitionsCache: OpenAiTool[] | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const server = createApplyerMcpServer()
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: 'applyer-chat', version: APP_VERSION })
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
      return client
    })().catch((err) => {
      // A failed handshake must not poison every later call with a
      // permanently rejected promise; the next caller gets a fresh attempt.
      clientPromise = null
      throw err
    })
  }
  return clientPromise
}

/** Converts one MCP tool's `inputSchema` (already JSON Schema) into the OpenAI function-calling shape, defaulting to an empty object schema rather than sending `parameters: undefined` for a tool that takes no arguments. */
function toOpenAiTool(tool: { name: string; description?: string; inputSchema: unknown }): OpenAiTool {
  const parameters: Record<string, unknown> =
    isRecord(tool.inputSchema) && tool.inputSchema.type === 'object'
      ? tool.inputSchema
      : { type: 'object', properties: {} }
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters }
  }
}

export async function listToolDefinitions(): Promise<OpenAiTool[]> {
  if (toolDefinitionsCache) return toolDefinitionsCache
  const client = await getClient()
  const { tools } = await client.listTools()
  const definitions = tools.map(toOpenAiTool)
  toolDefinitionsCache = definitions
  return definitions
}

/**
 * Text blocks are joined as-is (an MCP tool result is usually exactly
 * one); any other content kind becomes a short bracketed placeholder
 * rather than being dropped silently, so the model still knows something
 * came back. Takes `unknown` rather than the SDK's own content type: the
 * client's inferred `callTool` return type is a structural match for
 * whatever `resultSchema` was requested, not a name TypeScript exposes
 * here, so this validates each block's shape itself instead of trusting a
 * type that does not actually appear in the SDK's public exports.
 */
function flattenContent(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      parts.push('[unsupported content]')
      continue
    }
    switch (block.type) {
      case 'text':
        parts.push(typeof block.text === 'string' ? block.text : '[unsupported content]')
        break
      case 'image':
        parts.push('[image]')
        break
      case 'audio':
        parts.push('[audio]')
        break
      case 'resource_link':
        parts.push(typeof block.uri === 'string' ? `[resource: ${block.uri}]` : '[resource]')
        break
      case 'resource':
        parts.push('[resource]')
        break
      default:
        parts.push('[unsupported content]')
    }
  }
  return parts.join('\n')
}

export interface CallToolOutcome {
  text: string
  isError: boolean
}

export async function callTool(name: string, args: unknown): Promise<CallToolOutcome> {
  try {
    const client = await getClient()
    const result = await client.callTool({
      name,
      arguments: isRecord(args) ? args : {}
    })
    return { text: flattenContent(result.content), isError: result.isError === true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    appLogger.warn(`MCP tool call "${name}" failed: ${message}`)
    return { text: JSON.stringify({ error: message }), isError: true }
  }
}

/** Test-only: drops the cached client/tool list so a fresh test can reconnect against a fresh test database. */
export function __resetMcpBridgeForTests(): void {
  clientPromise = null
  toolDefinitionsCache = null
}
