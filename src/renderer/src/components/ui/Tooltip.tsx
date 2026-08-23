import { useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'

const VIEWPORT_MARGIN = 8
const GAP = 6

/**
 * `fixed`-positioned (not `absolute`) and viewport-clamped, same reasoning
 * and technique as `Dropdown`'s option panel: a trigger near a screen edge
 * (e.g. the navigation rail pinned to the left edge) would otherwise have
 * its centered-above label run off-screen. Position is measured off both
 * the trigger and the tooltip's own rendered size in a layout effect, so it
 * never paints in the wrong place first.
 */
export default function Tooltip({ label, children }: { label: string; children: ReactNode }): ReactElement {
  const [visible, setVisible] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean } | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    if (!visible) return
    const triggerRect = triggerRef.current?.getBoundingClientRect()
    const tooltipRect = tooltipRef.current?.getBoundingClientRect()
    if (!triggerRect || !tooltipRect) return

    const flip = triggerRect.top - tooltipRect.height - GAP < VIEWPORT_MARGIN
    const centeredLeft = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2
    const left = Math.max(
      VIEWPORT_MARGIN,
      Math.min(centeredLeft, window.innerWidth - tooltipRect.width - VIEWPORT_MARGIN)
    )
    const top = flip ? triggerRect.bottom + GAP : triggerRect.top - GAP

    setPos({ top, left, flip })
  }, [visible])

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span
          ref={tooltipRef}
          role="tooltip"
          style={{
            position: 'fixed',
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            transform: pos && !pos.flip ? 'translateY(-100%)' : undefined
          }}
          className="pointer-events-none z-50 whitespace-nowrap bg-canvas-raised px-2 py-1 text-[11px] text-text shadow-pop border border-border"
        >
          {label}
        </span>
      )}
    </span>
  )
}
