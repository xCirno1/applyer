import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'

const KEY_STEP_PX = 16
const KEY_STEP_LARGE_PX = 64

interface ResizeHandleProps {
  /** Orientation of the seam itself: `vertical` is a tall line dragged left/right. */
  orientation: 'vertical' | 'horizontal'
  /** Current size of the panel this handle resizes, in px. */
  value: number
  min: number
  max: number
  /**
   * True when the panel being resized sits *after* the handle, so moving the
   * pointer along the positive axis makes it smaller rather than larger.
   */
  invert?: boolean
  label: string
  onResize: (next: number) => void
}

/**
 * Draggable 1px seam between two panels. The pointer target is widened to
 * ~9px via an absolutely-positioned `::after` overhang rather than a chunky
 * gutter, keeping depth from seams rather than a decorative resize bar.
 * A real focusable `separator` with arrow-key resizing, not pointer-only.
 */
export default function ResizeHandle({
  orientation,
  value,
  min,
  max,
  invert = false,
  label,
  onResize
}: ResizeHandleProps): ReactElement {
  const [dragging, setDragging] = useState(false)
  const originRef = useRef(0)
  const startValueRef = useRef(value)
  const vertical = orientation === 'vertical'

  useEffect(() => {
    if (!dragging) return
    const { body } = document
    const previousUserSelect = body.style.userSelect
    const previousCursor = body.style.cursor
    body.style.userSelect = 'none'
    body.style.cursor = vertical ? 'col-resize' : 'row-resize'
    return () => {
      body.style.userSelect = previousUserSelect
      body.style.cursor = previousCursor
    }
  }, [dragging, vertical])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      originRef.current = vertical ? event.clientX : event.clientY
      startValueRef.current = value
      setDragging(true)
    },
    [vertical, value]
  )

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return
      const position = vertical ? event.clientX : event.clientY
      const delta = (position - originRef.current) * (invert ? -1 : 1)
      onResize(startValueRef.current + delta)
    },
    [dragging, vertical, invert, onResize]
  )

  const endDrag = useCallback(() => setDragging(false), [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const grow = vertical ? 'ArrowRight' : 'ArrowDown'
      const shrink = vertical ? 'ArrowLeft' : 'ArrowUp'
      const step = event.shiftKey ? KEY_STEP_LARGE_PX : KEY_STEP_PX
      const sign = invert ? -1 : 1

      if (event.key === grow) onResize(value + step * sign)
      else if (event.key === shrink) onResize(value - step * sign)
      else if (event.key === 'Home') onResize(min)
      else if (event.key === 'End') onResize(max)
      else return

      event.preventDefault()
    },
    [vertical, invert, value, min, max, onResize]
  )

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onLostPointerCapture={endDrag}
      onKeyDown={handleKeyDown}
      className={`relative z-10 shrink-0 touch-none transition-colors after:absolute after:content-[''] focus-visible:outline-none ${
        vertical
          ? 'w-px cursor-col-resize after:inset-y-0 after:-left-1 after:-right-1'
          : 'h-px cursor-row-resize after:inset-x-0 after:-top-1 after:-bottom-1'
      } ${dragging ? 'bg-accent' : 'bg-border hover:bg-accent focus-visible:bg-accent'}`}
    />
  )
}
