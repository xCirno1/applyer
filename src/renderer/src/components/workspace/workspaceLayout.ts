// The main workspace arrangement: which panels are showing and how big the
// three resizable regions (the pipeline sidebar, the terminal/logs dock, the
// chat panel on the right) are.
//
// This is a per-browser preference, not view state, so it lives in
// localStorage rather than component state that resets on remount — a reader
// who drags the dock taller shouldn't have it snap back every time a job
// update remounts a column.
//
// Deliberately no React here: the clamping/parsing rules are what's worth
// getting right, and they don't need a DOM to exercise.

import type { AgentMode } from '@shared/types/agentMode'

export type DockTab = 'terminal' | 'logs'

/**
 * The rail screens the dock can sit under. The dock itself is one instance
 * (one terminal session) mounted at the shell level; only *whether it is
 * showing* is remembered per screen, since a tall resume preview and a
 * kanban board want different amounts of the window.
 */
export type DockScreen = 'workspace' | 'indexedJobs' | 'resumes' | 'runs'
export const DOCK_SCREENS: readonly DockScreen[] = ['workspace', 'indexedJobs', 'resumes', 'runs']

export interface WorkspaceLayout {
  sidebarVisible: boolean
  dockVisible: Record<DockScreen, boolean>
  /** Pipeline sidebar width in px. */
  sidebarWidth: number
  /** Terminal/logs dock height in px. */
  dockHeight: number
  dockTab: DockTab
  /**
   * The OpenRouter chat panel on the right. One flag for every screen
   * (unlike `dockVisible`): the chat is a conversation the user keeps
   * going while moving between screens, so it stays where it is.
   */
  chatVisible: boolean
  /** Chat panel width in px. */
  chatWidth: number
}

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'workspace:layout:v1'

export const SIDEBAR_MIN_PX = 200
export const SIDEBAR_MAX_PX = 440
export const DOCK_MIN_PX = 120
export const DOCK_MAX_PX = 640
export const CHAT_MIN_PX = 300
export const CHAT_MAX_PX = 720

/** Floor on what the board keeps when a neighbour is dragged toward it. */
const MIN_BOARD_WIDTH_PX = 360
const MIN_BOARD_HEIGHT_PX = 200
/** What the rail screens keep beside the chat panel: a board column and a bit of overview. */
const MIN_SCREEN_WIDTH_PX = 480

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  sidebarVisible: true,
  dockVisible: { workspace: true, indexedJobs: true, resumes: true, runs: true },
  sidebarWidth: 260,
  dockHeight: 280,
  dockTab: 'terminal',
  chatVisible: true,
  chatWidth: 400
}

function clampBetween(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

export function clampSidebarWidth(width: number, available?: number): number {
  const ceiling = Number.isFinite(available)
    ? Math.min(SIDEBAR_MAX_PX, (available as number) - MIN_BOARD_WIDTH_PX)
    : SIDEBAR_MAX_PX
  return Math.round(clampBetween(width, SIDEBAR_MIN_PX, ceiling))
}

export function clampDockHeight(height: number, available?: number): number {
  const ceiling = Number.isFinite(available)
    ? Math.min(DOCK_MAX_PX, (available as number) - MIN_BOARD_HEIGHT_PX)
    : DOCK_MAX_PX
  return Math.round(clampBetween(height, DOCK_MIN_PX, ceiling))
}

export function clampChatWidth(width: number, available?: number): number {
  const ceiling = Number.isFinite(available)
    ? Math.min(CHAT_MAX_PX, (available as number) - MIN_SCREEN_WIDTH_PX)
    : CHAT_MAX_PX
  return Math.round(clampBetween(width, CHAT_MIN_PX, ceiling))
}

function isDockTab(value: unknown): value is DockTab {
  return value === 'terminal' || value === 'logs'
}

/**
 * Which dock tabs exist in a given agent mode. The Terminal tab is the CLI
 * agent's, so it follows `AgentMode` (see `shared/types/agentMode.ts`); in
 * `openrouter` mode the agent lives in the chat panel on the right instead,
 * and the dock is left with Logs alone. `null` (the mode hasn't loaded from
 * main yet) behaves like `'cli'`: Terminal first, so a dock that mounts
 * before the mode read resolves never flashes a tab strip that's about to
 * change a moment later.
 */
export function visibleDockTabs(mode: AgentMode | null): DockTab[] {
  return mode === 'openrouter' ? ['logs'] : ['terminal', 'logs']
}

/** Whether the chat panel exists at all in this mode; `chatVisible` only matters when it does. */
export function chatPanelAvailable(mode: AgentMode | null): boolean {
  return mode === 'openrouter'
}

/** The tab to land on when `tab` isn't visible in `mode`, most commonly right after a mode switch. */
export function coerceDockTab(tab: DockTab, mode: AgentMode | null): DockTab {
  const visible = visibleDockTabs(mode)
  return visible.includes(tab) ? tab : visible[0] ?? 'logs'
}

/**
 * Before the dock was shared across screens `dockVisible` was a single
 * boolean; a stored one still applies to every screen so an upgrade keeps
 * the user's choice. An object is read key by key with the default for
 * anything missing or not a boolean.
 */
function parseDockVisible(value: unknown): Record<DockScreen, boolean> {
  if (typeof value === 'boolean') {
    return { workspace: value, indexedJobs: value, resumes: value, runs: value }
  }
  const record = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const result = { ...DEFAULT_WORKSPACE_LAYOUT.dockVisible }
  for (const screen of DOCK_SCREENS) {
    if (typeof record[screen] === 'boolean') result[screen] = record[screen] as boolean
  }
  return result
}

/**
 * Rebuild a layout from whatever was in storage. Every field falls back
 * independently — this is user-writable storage, and a NaN width would
 * propagate straight into a style attribute (never trust received data).
 */
export function parseWorkspaceLayout(raw: unknown): WorkspaceLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_WORKSPACE_LAYOUT
  const value = raw as Record<string, unknown>

  const bool = (key: keyof WorkspaceLayout, fallback: boolean): boolean =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : fallback

  const size = (key: keyof WorkspaceLayout, fallback: number, clamp: (n: number) => number): number => {
    const parsed = Number(value[key])
    return clamp(Number.isFinite(parsed) ? parsed : fallback)
  }

  return {
    sidebarVisible: bool('sidebarVisible', DEFAULT_WORKSPACE_LAYOUT.sidebarVisible),
    dockVisible: parseDockVisible(value.dockVisible),
    sidebarWidth: size('sidebarWidth', DEFAULT_WORKSPACE_LAYOUT.sidebarWidth, clampSidebarWidth),
    dockHeight: size('dockHeight', DEFAULT_WORKSPACE_LAYOUT.dockHeight, clampDockHeight),
    // A stored 'chat' from before the chat moved out of the dock is simply
    // not a dock tab any more and falls back like any other bad value.
    dockTab: isDockTab(value.dockTab) ? value.dockTab : DEFAULT_WORKSPACE_LAYOUT.dockTab,
    chatVisible: bool('chatVisible', DEFAULT_WORKSPACE_LAYOUT.chatVisible),
    chatWidth: size('chatWidth', DEFAULT_WORKSPACE_LAYOUT.chatWidth, clampChatWidth)
  }
}

export function readStoredWorkspaceLayout(): WorkspaceLayout {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_LAYOUT_STORAGE_KEY)
    if (!raw) return DEFAULT_WORKSPACE_LAYOUT
    return parseWorkspaceLayout(JSON.parse(raw))
  } catch {
    // Disabled storage, a quota error, or malformed JSON — not worth
    // surfacing a failure for, fall back to the default layout.
    return DEFAULT_WORKSPACE_LAYOUT
  }
}

export function writeStoredWorkspaceLayout(layout: WorkspaceLayout): void {
  try {
    window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Same reasoning as the read — the layout still works for this session.
  }
}
