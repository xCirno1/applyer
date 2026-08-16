#!/usr/bin/env node
/**
 * Dumb stdio<->socket forwarder. This is what an MCP-capable CLI (claude,
 * codex, ...) actually spawns per the onboarding-generated config. It has
 * zero knowledge of JSON-RPC/MCP — it just pipes bytes between its own
 * stdin/stdout and a Unix socket (or Windows named pipe) that the running
 * JobHunt app is listening on. The real MCP server lives in the app's main
 * process; this only exists because CLIs speak stdio, not raw sockets.
 *
 * Usage: node mcp-bridge.mjs <socket-path>
 * The socket path is baked in by JobHunt's onboarding step, which knows the
 * app's actual userData directory — this script never computes it itself.
 */
import { createConnection } from 'node:net'

const socketPath = process.argv[2]

if (!socketPath) {
  process.stderr.write('mcp-bridge: missing socket path argument\n')
  process.exit(1)
}

const socket = createConnection(socketPath)

socket.on('connect', () => {
  process.stdin.pipe(socket)
  socket.pipe(process.stdout)
})

socket.on('error', (err) => {
  process.stderr.write(`mcp-bridge: socket error: ${err.message}\n`)
  process.stderr.write('Is the JobHunt app running? The MCP bridge only works while it is open.\n')
  process.exit(1)
})

socket.on('close', () => {
  process.exit(0)
})

process.stdin.on('error', () => {
  // EPIPE etc. when the parent CLI process exits — let socket 'close' drive the exit.
})
