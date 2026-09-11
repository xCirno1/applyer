import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createServer, type Server, type Socket } from 'net'
import { chmodSync, existsSync, unlinkSync } from 'fs'
import { createApplyerMcpServer } from './server'
import { LineFramer } from './lineFraming'
import { mcpLogger } from '../logger'

/**
 * Server-side Transport over a raw net.Socket, framed as newline-delimited
 * JSON — the same framing StdioServerTransport uses, so the stdio<->socket
 * bridge process can be a dumb byte-forwarder with zero JSON-RPC knowledge.
 *
 * Framing itself lives in `lineFraming.ts`, including the ceiling on an
 * un-terminated message: everything on this socket is data from another
 * process, so "how much will you buffer before giving up" has to have an
 * answer.
 */
class SocketServerTransport implements Transport {
  private readonly framer = new LineFramer()
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: (message: JSONRPCMessage) => void

  constructor(private readonly socket: Socket) {}

  async start(): Promise<void> {
    this.socket.setEncoding('utf-8')
    this.socket.on('data', (chunk: string) => this.handleData(chunk))
    this.socket.on('close', () => this.onclose?.())
    this.socket.on('error', (err: Error) => this.onerror?.(err))
  }

  private handleData(chunk: string): void {
    const result = this.framer.push(chunk)

    if (result.status === 'overflow') {
      // Nothing to salvage: the stream is mid-message with no framing to
      // resynchronise on, so the connection goes rather than the memory.
      this.onerror?.(
        new Error(`MCP message exceeded the size limit (${result.pendingBytes} bytes buffered without a newline)`)
      )
      this.socket.destroy()
      return
    }

    for (const line of result.lines) {
      try {
        this.onmessage?.(JSON.parse(line) as JSONRPCMessage)
      } catch (err) {
        this.onerror?.(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.socket.write(JSON.stringify(message) + '\n', (err) => (err ? reject(err) : resolve()))
    })
  }

  async close(): Promise<void> {
    this.socket.end()
  }
}

/**
 * Ceiling on live connections. One agent CLI holds one, and the onboarding
 * check briefly holds another, so anything near this many means something is
 * looping rather than working — and every connection costs a full `McpServer`
 * instance. Refusing beyond it keeps a runaway spawner from being the thing
 * that takes the app down.
 */
const MAX_CONNECTIONS = 32

/**
 * Restricts the socket to the user who owns it.
 *
 * A unix socket is created with the process umask applied, so under a
 * group-writable umask (0002, common on distributions with per-user groups)
 * another local account could connect and drive the MCP server: read the
 * candidate's profile and documents, queue jobs, open browser windows. 0600
 * says what is actually intended — this app, this user, this machine.
 *
 * There is a small window between `listen` and this call in which the
 * permissive mode applies; closing it properly needs the umask set around
 * bind, which is process-global and worse in an app with other threads
 * writing files. Windows named pipes take no mode at all — Node exposes no
 * way to set a pipe's DACL, so `\\.\pipe\applyer-mcp` keeps the default
 * (which does not grant remote or anonymous access).
 */
function restrictSocketAccess(socketPath: string): void {
  if (process.platform === 'win32') return
  try {
    chmodSync(socketPath, 0o600)
  } catch (err) {
    mcpLogger.warn(`Could not restrict permissions on the MCP socket: ${String(err)}`)
  }
}

export function startMcpSocketServer(socketPath: string): Server {
  if (process.platform !== 'win32' && existsSync(socketPath)) {
    unlinkSync(socketPath)
  }

  let openConnections = 0

  const server = createServer((socket) => {
    if (openConnections >= MAX_CONNECTIONS) {
      mcpLogger.warn(`Refused an MCP connection: ${MAX_CONNECTIONS} already open`)
      socket.destroy()
      return
    }

    openConnections += 1
    socket.on('close', () => {
      openConnections -= 1
    })

    const mcpServer = createApplyerMcpServer()
    const transport = new SocketServerTransport(socket)

    mcpServer.connect(transport).catch((err) => {
      mcpLogger.error(`Failed to connect MCP server to socket transport: ${String(err)}`)
      socket.destroy()
    })

    socket.on('error', (err) => {
      mcpLogger.warn(`MCP socket connection error: ${String(err)}`)
    })
  })

  server.on('error', (err) => {
    mcpLogger.error(`MCP socket server error: ${String(err)}`)
  })

  server.listen(socketPath, () => {
    restrictSocketAccess(socketPath)
    mcpLogger.info(`MCP server listening on ${socketPath}`)
  })

  return server
}
