import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js'
import { createServer, type Server, type Socket } from 'net'
import { existsSync, unlinkSync } from 'fs'
import { createApplyerMcpServer } from './server'
import { mcpLogger } from '../logger'

/**
 * Server-side Transport over a raw net.Socket, framed as newline-delimited
 * JSON — the same framing StdioServerTransport uses, so the stdio<->socket
 * bridge process can be a dumb byte-forwarder with zero JSON-RPC knowledge.
 */
class SocketServerTransport implements Transport {
  private readBuffer = ''
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
    this.readBuffer += chunk
    let newlineIndex: number
    while ((newlineIndex = this.readBuffer.indexOf('\n')) >= 0) {
      const line = this.readBuffer.slice(0, newlineIndex)
      this.readBuffer = this.readBuffer.slice(newlineIndex + 1)
      if (!line.trim()) continue
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

export function startMcpSocketServer(socketPath: string): Server {
  if (process.platform !== 'win32' && existsSync(socketPath)) {
    unlinkSync(socketPath)
  }

  const server = createServer((socket) => {
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
    mcpLogger.info(`MCP server listening on ${socketPath}`)
  })

  return server
}
