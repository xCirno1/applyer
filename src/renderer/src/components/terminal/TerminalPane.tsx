import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import { useTheme } from '../../providers/ThemeContext'
import { isMacPlatform } from '../../shortcuts/keyCombo'
import { useToast } from '../ui/useToast'
import {
  DELETE_WORD_SEQUENCE,
  KittyKeyboardState,
  matchTerminalKeyBinding,
  newlineSequence,
  readCsiParam
} from './terminalKeys'
import TerminalSearchBar, {
  SEARCH_WIDTH_DEFAULT_PX,
  SEARCH_WIDTH_MAX_PX,
  SEARCH_WIDTH_MIN_PX
} from './TerminalSearchBar'

/**
 * xterm's canvas/WebGL renderer needs a concrete color, not a CSS variable
 * or a transparent value (both render as opaque black) — so we resolve the
 * design token to its computed color via a throwaway element.
 */
function resolveCssColor(cssVarExpression: string): string {
  const probe = document.createElement('div')
  probe.style.color = cssVarExpression
  probe.style.display = 'none'
  document.body.appendChild(probe)
  const resolved = getComputedStyle(probe).color
  probe.remove()
  return resolved
}

/**
 * Convert a resolved `rgb(r, g, b)` string to `rgba(r, g, b, alpha)` — used
 * to give a solid theme color some translucency without needing a second
 * design token per use site.
 */
function withAlpha(rgbColor: string, alpha: number): string {
  const channels = rgbColor.match(/\d+(?:\.\d+)?/g) ?? []
  return `rgba(${channels[0] ?? 0}, ${channels[1] ?? 0}, ${channels[2] ?? 0}, ${alpha})`
}

/**
 * `SearchAddon`'s decoration colors are `#RRGGBB` only (no `rgba()`,
 * unlike the rest of this file's theme resolution), so resolved channels are
 * hex-packed here instead of going through `withAlpha`.
 */
function resolveCssColorHex(cssVarExpression: string): string {
  const channels = resolveCssColor(cssVarExpression).match(/\d+(?:\.\d+)?/g) ?? []
  const hex = (n: string | undefined): string =>
    Math.max(0, Math.min(255, Math.round(Number(n ?? 0))))
      .toString(16)
      .padStart(2, '0')
  return `#${hex(channels[0])}${hex(channels[1])}${hex(channels[2])}`
}

/**
 * Highlight colors for `SearchAddon`: every match in the theme's warning
 * color, the current match in the accent color so it stands out from the
 * rest — resolved fresh per search call rather than cached, same reasoning
 * as `resolveTerminalTheme`.
 */
function resolveSearchDecorationColors(): NonNullable<ISearchOptions['decorations']> {
  const match = resolveCssColorHex('var(--color-warning)')
  const active = resolveCssColorHex('var(--color-accent)')
  return {
    matchBackground: match,
    matchBorder: match,
    matchOverviewRuler: match,
    activeMatchBackground: active,
    activeMatchBorder: active,
    activeMatchColorOverviewRuler: active
  }
}

function resolveTerminalTheme(): {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
} {
  const background = resolveCssColor('var(--color-canvas-raised)')
  const foreground = resolveCssColor('var(--color-text)')
  return {
    background,
    foreground,
    // xterm defaults an unset cursor to white, which disappears against a
    // light-mode background — pin it to the theme's own colors instead so
    // it's always a solid, visible block regardless of scheme.
    cursor: foreground,
    cursorAccent: background,
    // xterm's default (unset) selection highlight is a translucent white
    // overlay, which reads fine on a dark background but is nearly
    // invisible on a light one — use the theme's accent color instead so
    // selected text stays visible in both schemes.
    selectionBackground: withAlpha(resolveCssColor('var(--color-accent)'), 0.35)
  }
}

/**
 * `rgb:rrrr/gggg/bbbb`, the reply format for OSC 10/11/12 color queries —
 * an 8-bit-per-channel color doubled into the 16-bit-per-channel hex triplet
 * the spec expects.
 */
function toOscColorReply(cssVarExpression: string): string {
  const resolved = resolveCssColor(cssVarExpression)
  const channels = resolved.match(/\d+(?:\.\d+)?/g) ?? []
  const hex = (n: string | undefined): string => {
    const clamped = Math.max(0, Math.min(255, Math.round(Number(n ?? 0))))
    const byte = clamped.toString(16).padStart(2, '0')
    return byte + byte
  }
  return `rgb:${hex(channels[0])}/${hex(channels[1])}/${hex(channels[2])}`
}

/** Imperative handle so `TerminalGroup` can open the active pane's find bar from the global `terminal.search` shortcut. */
export interface TerminalPaneHandle {
  openSearch: () => void
}

const DEFAULT_SEARCH_OPTIONS: Record<'caseSensitive' | 'wholeWord' | 'regex', boolean> = {
  caseSensitive: false,
  wholeWord: false,
  regex: false
}

const TerminalPane = forwardRef<TerminalPaneHandle>(function TerminalPane(_props, ref): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const { state, resolvedScheme } = useTheme()
  const { t } = useTranslation('workspace')
  const toast = useToast()

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchFocusToken, setSearchFocusToken] = useState(0)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOptions, setSearchOptions] = useState(DEFAULT_SEARCH_OPTIONS)
  const [searchResult, setSearchResult] = useState({ index: -1, count: 0 })
  const [searchWidth, setSearchWidth] = useState(SEARCH_WIDTH_DEFAULT_PX)

  const handleSearchWidthChange = (next: number): void => {
    setSearchWidth(Math.round(Math.min(SEARCH_WIDTH_MAX_PX, Math.max(SEARCH_WIDTH_MIN_PX, next))))
  }

  /**
   * `direction` here means "next/previous result in the panel's own newest
   * → oldest listing", not the addon's row-order search direction — they're
   * opposites. Terminal scrollback is chronological (row 0 is the oldest
   * line, the bottom is newest), but the addon's own match numbering
   * (`resultIndex`/`resultCount`, and which end `findNext`/`findPrevious`
   * start from with no existing selection) runs oldest-first, bottom-to-top
   * for `findPrevious`. Since the most recent output is what you're usually
   * after in a terminal, our "next" walks from the newest match toward
   * older ones — i.e. `findPrevious` — and "previous" walks back toward the
   * newest — `findNext`. `TerminalSearchBar` un-flips the displayed "N of M"
   * to match (see its `resultCount - resultIndex`).
   */
  const runSearch = (
    direction: 'next' | 'previous',
    query: string,
    options: typeof searchOptions,
    incremental = false
  ): void => {
    const addon = searchAddonRef.current
    if (!addon) return
    if (!query) {
      addon.clearDecorations()
      setSearchResult({ index: -1, count: 0 })
      return
    }
    const findOptions: ISearchOptions = { ...options, incremental, decorations: resolveSearchDecorationColors() }
    if (direction === 'next') addon.findPrevious(query, findOptions)
    else addon.findNext(query, findOptions)
  }

  /**
   * `findNext`/`findPrevious` pick up right where the *previous* call left
   * off: if the search term is unchanged since then, they anchor at the
   * current match's edge and jump to the one after it, even though nothing
   * asked to move — that's what made reopening the bar or flipping a filter
   * feel like it was silently skipping ahead. Clearing the terminal's
   * selection first removes that anchor, so these "just refresh" call sites
   * land back on the newest match deterministically instead (with no
   * selection, `findPrevious` — what `runSearch('next', ...)` now maps to —
   * starts at the bottom of the buffer, i.e. the most recent output).
   */
  const restartSearch = (query: string, options: typeof searchOptions): void => {
    termRef.current?.clearSelection()
    runSearch('next', query, options)
  }

  const openSearch = (): void => {
    setSearchOpen(true)
    setSearchFocusToken((n) => n + 1)
    if (searchQuery) restartSearch(searchQuery, searchOptions)
  }

  const closeSearch = (): void => {
    searchAddonRef.current?.clearDecorations()
    setSearchOpen(false)
    setSearchResult({ index: -1, count: 0 })
    termRef.current?.focus()
  }

  // Deliberately keyed on the state `openSearch` closes over rather than the
  // function itself, which is a fresh identity every render regardless.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useImperativeHandle(ref, () => ({ openSearch }), [searchQuery, searchOptions])

  const updateQuery = (query: string): void => {
    setSearchQuery(query)
    runSearch('next', query, searchOptions, true)
  }

  const toggleSearchOption = (key: keyof typeof searchOptions): void => {
    setSearchOptions((prev) => {
      const next = { ...prev, [key]: !prev[key] }
      restartSearch(searchQuery, next)
      return next
    })
  }

  // Mirrors the translator and toast pusher outside of render, so the
  // mount-once session effect below can reach the current ones without
  // tearing down its pty every time the locale changes. Same pattern as
  // `useWorkspaceLayout`'s `layoutRef`.
  const notifyRef = useRef({ t, toast })
  useEffect(() => {
    notifyRef.current = { t, toast }
  }, [t, toast])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: resolveTerminalTheme(),
      allowProposedApi: true
    })
    termRef.current = term

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    try {
      term.loadAddon(new WebglAddon())
    } catch {
      // WebGL renderer unavailable in this environment — falls back to the
      // default DOM renderer automatically, no action needed.
    }

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    const searchResultsDisposable = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
      setSearchResult({ index: resultIndex, count: resultCount })
    })

    term.open(container)
    fitAddon.fit()

    let sessionId: string | undefined
    let disposed = false
    const kittyKeyboard = new KittyKeyboardState()
    let removeDataListener: (() => void) | undefined
    let removeExitListener: (() => void) | undefined

    window.api.terminal
      .create({ cols: term.cols, rows: term.rows })
      .then((result) => {
        if (disposed) {
          // Cleanup already ran before this resolved (e.g. StrictMode's
          // dev-only double-mount) — `sessionId` in the closure below never
          // gets set, so the outer cleanup's dispose call is a no-op. Without
          // this, the pty it just spawned (auto-start command and all) would
          // leak until the whole app quits.
          window.api.terminal.dispose(result.sessionId)
          return
        }
        sessionId = result.sessionId

        removeDataListener = window.api.terminal.onData((payload) => {
          if (payload.sessionId === sessionId) {
            term.write(payload.data)
          }
        })

        removeExitListener = window.api.terminal.onExit((payload) => {
          if (payload.sessionId === sessionId) {
            term.write(`\r\n\x1b[90m[process exited with code ${payload.exitCode}]\x1b[0m\r\n`)
          }
        })
      })
      .catch((err) => {
        term.write(`\r\n\x1b[31mFailed to start terminal: ${String(err)}\x1b[0m\r\n`)
      })

    const onDataDisposable = term.onData((data) => {
      if (sessionId) {
        window.api.terminal.write(sessionId, data)
      }
    })

    // Everything the terminal handles itself instead of forwarding to the
    // pty. Without a handler here, xterm's stock keymap sees every
    // keystroke: Ctrl+Shift+C sends the same 0x03 (SIGINT) byte as Ctrl+C
    // rather than copying, Shift+Enter sends the same "\r" as Enter, so the
    // program inside cannot tell a newline from a submit, and Ctrl+Backspace
    // sends a bare BS, which deletes one character rather than a word.
    const isMac = isMacPlatform()
    term.attachCustomKeyEventHandler((event) => {
      const binding = matchTerminalKeyBinding(event, {
        isMac,
        kittyKeyboardEnabled: kittyKeyboard.enabled
      })
      if (!binding) return true

      // The matcher answers for the companion keypress/keyup too, which have
      // to be swallowed as well: xterm only skips its keypress path when its
      // own keydown handling ran, and Shift+Enter's keypress carries
      // charCode 13, which would arrive as a second, plain "\r".
      event.preventDefault()
      if (event.type !== 'keydown') return false

      if (binding === 'copy') {
        const selection = term.getSelection()
        if (selection) window.api.clipboard.writeText(selection)
        return false
      }

      if (binding === 'paste') {
        window.api.clipboard
          .readText()
          .then((text) => {
            // Through xterm rather than straight down the pty, so bracketed
            // paste is applied when the program inside has asked for it.
            if (text) term.paste(text)
          })
          .catch(() => {
            notifyRef.current.toast.error(notifyRef.current.t('terminal.pasteFailed'))
          })
        return false
      }

      const sequence =
        binding === 'newline' ? newlineSequence(kittyKeyboard.enabled) : DELETE_WORD_SEQUENCE
      if (sessionId) {
        window.api.terminal.write(sessionId, sequence)
      }
      return false
    })

    // Kitty keyboard protocol mode changes, tracked so Shift+Enter is
    // encoded the way the program inside expects. The protocol's `CSI ? u`
    // query is deliberately left unanswered — see KittyKeyboardState.
    const kittyPushDisposable = term.parser.registerCsiHandler({ prefix: '>', final: 'u' }, (params) => {
      kittyKeyboard.push(readCsiParam(params, 0, 0))
      return true
    })
    const kittyPopDisposable = term.parser.registerCsiHandler({ prefix: '<', final: 'u' }, (params) => {
      kittyKeyboard.pop(readCsiParam(params, 0, 1))
      return true
    })
    const kittySetDisposable = term.parser.registerCsiHandler({ prefix: '=', final: 'u' }, (params) => {
      kittyKeyboard.set(readCsiParam(params, 0, 0), readCsiParam(params, 1, 1))
      return true
    })
    // RIS clears the keyboard mode along with the rest of the terminal
    // state; returning false lets xterm still perform the reset itself.
    const resetDisposable = term.parser.registerEscHandler({ final: 'c' }, () => {
      kittyKeyboard.reset()
      return false
    })

    // CLI programs that adapt their own light/dark styling (Codex, and
    // others built on TUI frameworks that support it) do so by asking the
    // terminal what its foreground/background color is via these OSC
    // queries — xterm.js doesn't answer them on its own, so without this
    // they fall back to whatever they assume by default. The reply goes
    // back down the pty as if it were typed input, since that's the same
    // channel the query arrived on.
    const oscForegroundDisposable = term.parser.registerOscHandler(10, (data) => {
      if (data !== '?' || !sessionId) return false
      window.api.terminal.write(sessionId, `\x1b]10;${toOscColorReply('var(--color-text)')}\x07`)
      return true
    })
    const oscBackgroundDisposable = term.parser.registerOscHandler(11, (data) => {
      if (data !== '?' || !sessionId) return false
      window.api.terminal.write(sessionId, `\x1b]11;${toOscColorReply('var(--color-canvas-raised)')}\x07`)
      return true
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (sessionId) {
        window.api.terminal.resize(sessionId, term.cols, term.rows)
      }
    })
    resizeObserver.observe(container)

    return () => {
      disposed = true
      resizeObserver.disconnect()
      onDataDisposable.dispose()
      searchResultsDisposable.dispose()
      kittyPushDisposable.dispose()
      kittyPopDisposable.dispose()
      kittySetDisposable.dispose()
      resetDisposable.dispose()
      oscForegroundDisposable.dispose()
      oscBackgroundDisposable.dispose()
      removeDataListener?.()
      removeExitListener?.()
      if (sessionId) {
        window.api.terminal.dispose(sessionId)
      }
      termRef.current = null
      searchAddonRef.current = null
      term.dispose()
    }
  }, [])

  // Refocuses the find input every time `openSearch` fires, even when the
  // bar was already open (e.g. pressing the shortcut again to re-find) —
  // `searchOpen` alone wouldn't retrigger a mount-time `autoFocus`.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus()
  }, [searchOpen, searchFocusToken])

  // Re-applies whenever the resolved scheme changes, or any other part of
  // the theme state does — accent/customCss don't touch these two tokens by
  // default, but a user's own custom CSS overriding --color-text or
  // --color-canvas-raised should still be picked up live.
  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = resolveTerminalTheme()
    // Re-paints existing match highlights in the new theme's colors too —
    // otherwise they'd keep the old scheme's palette until the next search.
    if (searchOpen && searchQuery) restartSearch(searchQuery, searchOptions)
    // Deliberately theme-triggered only — re-running on every keystroke
    // instead would fight the input's own findNext calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedScheme, state])

  return (
    <div className="relative h-full w-full">
      {searchOpen && (
        <TerminalSearchBar
          ref={searchInputRef}
          width={searchWidth}
          onWidthChange={handleSearchWidthChange}
          query={searchQuery}
          onQueryChange={updateQuery}
          caseSensitive={searchOptions.caseSensitive}
          wholeWord={searchOptions.wholeWord}
          regex={searchOptions.regex}
          onToggleCaseSensitive={() => toggleSearchOption('caseSensitive')}
          onToggleWholeWord={() => toggleSearchOption('wholeWord')}
          onToggleRegex={() => toggleSearchOption('regex')}
          resultIndex={searchResult.index}
          resultCount={searchResult.count}
          onNext={() => runSearch('next', searchQuery, searchOptions)}
          onPrevious={() => runSearch('previous', searchQuery, searchOptions)}
          onClose={closeSearch}
          onInputBlur={() => searchAddonRef.current?.clearActiveDecoration()}
        />
      )}
      <div ref={containerRef} className="h-full w-full px-3 py-1.5" />
    </div>
  )
})

export default TerminalPane
