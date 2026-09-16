/**
 * Which agent drives the embedded dock: a CLI coding agent (Claude Code,
 * Codex, …) typed into an embedded terminal and connected to Applyer's MCP
 * server over stdio, or an in-app chat that calls the same MCP tools
 * in-process against an OpenRouter-hosted model. The two are exclusive:
 * switching mode swaps which dock tab (`Terminal` vs `Chat`) is visible,
 * but never destructive: the hidden mode's data (terminal scrollback via its
 * pty, chat sessions in SQLite) is kept, so flipping back and forth loses
 * nothing.
 */
export type AgentMode = 'cli' | 'openrouter'

export const DEFAULT_AGENT_MODE: AgentMode = 'cli'

/** Runtime guard for a persisted setting or an IPC-supplied value. */
export function isAgentMode(value: unknown): value is AgentMode {
  return value === 'cli' || value === 'openrouter'
}
