// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import {
  WORKSPACE_LAYOUT_STORAGE_KEY,
  SIDEBAR_MIN_PX,
  SIDEBAR_MAX_PX,
  DOCK_MIN_PX,
  DOCK_MAX_PX,
  CHAT_MIN_PX,
  CHAT_MAX_PX,
  DEFAULT_WORKSPACE_LAYOUT,
  chatPanelAvailable,
  clampChatWidth,
  clampSidebarWidth,
  clampDockHeight,
  coerceDockTab,
  parseWorkspaceLayout,
  readStoredWorkspaceLayout,
  visibleDockTabs,
  writeStoredWorkspaceLayout
} from './workspaceLayout'

beforeEach(() => {
  window.localStorage.clear()
})

describe('clampSidebarWidth', () => {
  it('clamps to [SIDEBAR_MIN_PX, SIDEBAR_MAX_PX] with no available-space constraint', () => {
    expect(clampSidebarWidth(10)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(10000)).toBe(SIDEBAR_MAX_PX)
    expect(clampSidebarWidth(300)).toBe(300)
  })

  it('falls back to the min for a non-finite value', () => {
    expect(clampSidebarWidth(NaN)).toBe(SIDEBAR_MIN_PX)
    expect(clampSidebarWidth(Infinity)).toBe(SIDEBAR_MIN_PX)
  })

  it('caps the ceiling using available space and the board\'s minimum width', () => {
    // available=700, board floor=360 -> ceiling = min(SIDEBAR_MAX_PX, 340) = 340
    expect(clampSidebarWidth(10000, 700)).toBe(340)
  })

  it('prefers SIDEBAR_MIN_PX over an impossibly tight ceiling rather than violating the sidebar minimum', () => {
    // available=500, board floor=360 -> computed ceiling (140) is below
    // SIDEBAR_MIN_PX (200) itself; clampBetween's `max < min` guard falls
    // back to min rather than returning something smaller than the sidebar
    // is ever allowed to be.
    expect(clampSidebarWidth(10000, 500)).toBe(SIDEBAR_MIN_PX)
  })

  it('rounds to the nearest integer', () => {
    expect(clampSidebarWidth(250.6)).toBe(251)
  })
})

describe('clampDockHeight', () => {
  it('clamps to [DOCK_MIN_PX, DOCK_MAX_PX]', () => {
    expect(clampDockHeight(0)).toBe(DOCK_MIN_PX)
    expect(clampDockHeight(10000)).toBe(DOCK_MAX_PX)
  })

  it('caps the ceiling using available space and the board\'s minimum height', () => {
    // available=500, board floor=200 -> ceiling = min(DOCK_MAX_PX, 300) = 300
    expect(clampDockHeight(10000, 500)).toBe(300)
  })

  it('prefers DOCK_MIN_PX over an impossibly tight ceiling rather than violating the dock minimum', () => {
    // available=300, board floor=200 -> computed ceiling (100) is below
    // DOCK_MIN_PX (120) itself; same `max < min` guard as clampSidebarWidth.
    expect(clampDockHeight(10000, 300)).toBe(DOCK_MIN_PX)
  })
})

describe('parseWorkspaceLayout', () => {
  it('returns the default for non-object input', () => {
    expect(parseWorkspaceLayout(null)).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    expect(parseWorkspaceLayout('x')).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    expect(parseWorkspaceLayout([1])).toEqual(DEFAULT_WORKSPACE_LAYOUT)
  })

  it('accepts a fully valid layout', () => {
    const layout = {
      sidebarVisible: false,
      dockVisible: { workspace: false, indexedJobs: true, resumes: false, runs: true },
      sidebarWidth: 300,
      dockHeight: 200,
      dockTab: 'logs',
      chatVisible: false,
      chatWidth: 360
    }
    expect(parseWorkspaceLayout(layout)).toEqual(layout)
  })

  it('treats a stored dockTab of chat (from before the chat left the dock) as a bad value', () => {
    const result = parseWorkspaceLayout({ dockTab: 'chat', chatVisible: true })
    expect(result.dockTab).toBe(DEFAULT_WORKSPACE_LAYOUT.dockTab)
    expect(result.chatVisible).toBe(true)
  })

  it('falls back for a missing or non-boolean chatVisible and clamps chatWidth', () => {
    expect(parseWorkspaceLayout({}).chatVisible).toBe(DEFAULT_WORKSPACE_LAYOUT.chatVisible)
    expect(parseWorkspaceLayout({ chatVisible: 'yes' }).chatVisible).toBe(DEFAULT_WORKSPACE_LAYOUT.chatVisible)
    expect(parseWorkspaceLayout({ chatWidth: 10 }).chatWidth).toBe(CHAT_MIN_PX)
    expect(parseWorkspaceLayout({ chatWidth: 99999 }).chatWidth).toBe(CHAT_MAX_PX)
  })

  it('applies a legacy boolean dockVisible to every screen', () => {
    expect(parseWorkspaceLayout({ dockVisible: false }).dockVisible).toEqual({
      workspace: false,
      indexedJobs: false,
      resumes: false,
      runs: false
    })
    expect(parseWorkspaceLayout({ dockVisible: true }).dockVisible).toEqual(DEFAULT_WORKSPACE_LAYOUT.dockVisible)
  })

  it('reads dockVisible per screen with the default for missing or non-boolean keys', () => {
    expect(parseWorkspaceLayout({ dockVisible: { resumes: false, workspace: 'no' } }).dockVisible).toEqual({
      workspace: true,
      indexedJobs: true,
      resumes: false,
      runs: true
    })
    expect(parseWorkspaceLayout({ dockVisible: [false] }).dockVisible).toEqual(DEFAULT_WORKSPACE_LAYOUT.dockVisible)
    expect(parseWorkspaceLayout({ dockVisible: 'yes' }).dockVisible).toEqual(DEFAULT_WORKSPACE_LAYOUT.dockVisible)
  })

  it('falls back field-by-field: bad dockTab does not discard other valid fields', () => {
    const result = parseWorkspaceLayout({ sidebarVisible: false, dockTab: 'not-a-tab' })
    expect(result.sidebarVisible).toBe(false)
    expect(result.dockTab).toBe(DEFAULT_WORKSPACE_LAYOUT.dockTab)
  })

  it('clamps a NaN or out-of-range width/height rather than trusting it', () => {
    const result = parseWorkspaceLayout({ sidebarWidth: 'not a number', dockHeight: -500 })
    expect(result.sidebarWidth).toBe(DEFAULT_WORKSPACE_LAYOUT.sidebarWidth)
    expect(result.dockHeight).toBe(DOCK_MIN_PX)
  })

  it('coerces numeric strings for width/height', () => {
    const result = parseWorkspaceLayout({ sidebarWidth: '300' })
    expect(result.sidebarWidth).toBe(300)
  })
})

describe('clampChatWidth', () => {
  it('clamps to [CHAT_MIN_PX, CHAT_MAX_PX]', () => {
    expect(clampChatWidth(10)).toBe(CHAT_MIN_PX)
    expect(clampChatWidth(5000)).toBe(CHAT_MAX_PX)
    expect(clampChatWidth(400)).toBe(400)
  })

  it('caps the ceiling so the rail screens keep their minimum width', () => {
    expect(clampChatWidth(700, 1000)).toBe(520)
  })

  it('prefers CHAT_MIN_PX over an impossibly tight ceiling', () => {
    expect(clampChatWidth(400, 500)).toBe(CHAT_MIN_PX)
  })
})

describe('chatPanelAvailable', () => {
  it('only exists in openrouter mode', () => {
    expect(chatPanelAvailable('openrouter')).toBe(true)
    expect(chatPanelAvailable('cli')).toBe(false)
    expect(chatPanelAvailable(null)).toBe(false)
  })
})

describe('visibleDockTabs', () => {
  it('shows only Logs in openrouter mode, since the chat is its own panel', () => {
    expect(visibleDockTabs('openrouter')).toEqual(['logs'])
  })

  it('shows Terminal + Logs in cli mode', () => {
    expect(visibleDockTabs('cli')).toEqual(['terminal', 'logs'])
  })

  it('behaves like cli mode while the mode has not loaded yet, so nothing flickers', () => {
    expect(visibleDockTabs(null)).toEqual(['terminal', 'logs'])
  })
})

describe('coerceDockTab', () => {
  it('keeps a tab that is already visible', () => {
    expect(coerceDockTab('logs', 'cli')).toBe('logs')
    expect(coerceDockTab('logs', 'openrouter')).toBe('logs')
  })

  it('falls back to the first visible tab when the current one disappeared', () => {
    expect(coerceDockTab('terminal', 'openrouter')).toBe('logs')
  })
})

describe('readStoredWorkspaceLayout / writeStoredWorkspaceLayout', () => {
  it('round-trips through localStorage', () => {
    const layout = { ...DEFAULT_WORKSPACE_LAYOUT, sidebarWidth: 321 }
    writeStoredWorkspaceLayout(layout)
    expect(readStoredWorkspaceLayout()).toEqual(layout)
  })

  it('returns the default when nothing is stored or JSON is malformed', () => {
    expect(readStoredWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT)
    window.localStorage.setItem(WORKSPACE_LAYOUT_STORAGE_KEY, '{bad json')
    expect(readStoredWorkspaceLayout()).toEqual(DEFAULT_WORKSPACE_LAYOUT)
  })
})
