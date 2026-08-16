import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function jsonResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

export function textError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
