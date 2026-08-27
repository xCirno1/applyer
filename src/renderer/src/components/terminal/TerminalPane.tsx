import { useEffect, useRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
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

export default function TerminalPane(): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const { state, resolvedScheme } = useTheme()
  const { t } = useTranslation('workspace')
  const toast = useToast()

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
      term.dispose()
    }
  }, [])

  // Re-applies whenever the resolved scheme changes, or any other part of
  // the theme state does — accent/customCss don't touch these two tokens by
  // default, but a user's own custom CSS overriding --color-text or
  // --color-canvas-raised should still be picked up live.
  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = resolveTerminalTheme()
  }, [resolvedScheme, state])

  return <div ref={containerRef} className="h-full w-full px-3 py-1.5" />
}
