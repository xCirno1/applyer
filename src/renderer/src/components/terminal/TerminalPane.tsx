import { useEffect, useRef, type ReactElement } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

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

export default function TerminalPane(): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      theme: {
        background: resolveCssColor('var(--color-canvas-raised)'),
        foreground: resolveCssColor('var(--color-text)')
      },
      allowProposedApi: true
    })

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
    let removeDataListener: (() => void) | undefined
    let removeExitListener: (() => void) | undefined

    window.api.terminal
      .create({ cols: term.cols, rows: term.rows })
      .then((result) => {
        if (disposed) return
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
      removeDataListener?.()
      removeExitListener?.()
      if (sessionId) {
        window.api.terminal.dispose(sessionId)
      }
      term.dispose()
    }
  }, [])

  return <div ref={containerRef} className="h-full w-full px-3 py-1.5" />
}
