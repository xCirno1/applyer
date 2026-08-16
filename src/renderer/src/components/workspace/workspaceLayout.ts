// The main workspace arrangement: which panels are showing and how big the
// two resizable regions (the pipeline sidebar, the terminal/logs dock) are.
//
// This is a per-browser preference, not view state, so it lives in
// localStorage rather than component state that resets on remount — a reader
// who drags the dock taller shouldn't have it snap back every time a job
// update remounts a column.
//
// Deliberately no React here: the clamping/parsing rules are what's worth
// getting right, and they don't need a DOM to exercise.

export type DockTab = 'terminal' | 'logs'

export interface WorkspaceLayout {
  sidebarVisible: boolean
  dockVisible: boolean
  /** Pipeline sidebar width in px. */
  sidebarWidth: number
  /** Terminal/logs dock height in px. */
  dockHeight: number
  dockTab: DockTab
}

export const WORKSPACE_LAYOUT_STORAGE_KEY = 'workspace:layout:v1'

export const SIDEBAR_MIN_PX = 200
export const SIDEBAR_MAX_PX = 440
export const DOCK_MIN_PX = 120
export const DOCK_MAX_PX = 640

/** Floor on what the board keeps when a neighbour is dragged toward it. */
const MIN_BOARD_WIDTH_PX = 360
const MIN_BOARD_HEIGHT_PX = 200

export const DEFAULT_WORKSPACE_LAYOUT: WorkspaceLayout = {
  sidebarVisible: true,
  dockVisible: true,
  sidebarWidth: 260,
  dockHeight: 280,
  dockTab: 'terminal'
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

function isDockTab(value: unknown): value is DockTab {
  return value === 'terminal' || value === 'logs'
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
    dockVisible: bool('dockVisible', DEFAULT_WORKSPACE_LAYOUT.dockVisible),
    sidebarWidth: size('sidebarWidth', DEFAULT_WORKSPACE_LAYOUT.sidebarWidth, clampSidebarWidth),
    dockHeight: size('dockHeight', DEFAULT_WORKSPACE_LAYOUT.dockHeight, clampDockHeight),
    dockTab: isDockTab(value.dockTab) ? value.dockTab : DEFAULT_WORKSPACE_LAYOUT.dockTab
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
