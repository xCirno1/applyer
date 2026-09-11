/*
 * How far the toast stack sits above the bottom of the window.
 *
 * Toasts are pinned to the bottom-right corner, which is empty on every
 * screen the app normally shows. A screen with a full-width footer band puts
 * its primary action in exactly that corner, and a toast landing on top of
 * it does not just look wrong: the toast has `pointer-events-auto`, so for
 * the four and a half seconds it is up, the button underneath cannot be
 * clicked at all.
 *
 * Rather than teach `ToastProvider` about particular screens, the screen
 * that owns bottom chrome reports its height here and the stack reads it as
 * a CSS variable. Kept as a plain module (no React) so the fallback and the
 * clearing rule are one thing in one place, and so a caller can reset it
 * from an effect cleanup without a hook in the way.
 */

const CSS_VARIABLE = '--toast-inset-bottom'

/** The corner inset used when no screen has reserved anything, matching the old `bottom-3`. */
export const DEFAULT_TOAST_INSET_PX = 12

/** Gap left between the reserved chrome and the lowest toast. */
export const TOAST_INSET_GAP_PX = 12

/**
 * Reserve `heightPx` of bottom chrome, or pass `null` to release it. A
 * non-finite or negative height is ignored rather than written, since it
 * would push the stack off-screen entirely: a measurement taken before
 * layout settles is the likely source, and one bad frame must not cost the
 * user every toast that follows.
 */
export function setToastInset(heightPx: number | null): void {
  const root = document.documentElement
  if (heightPx === null) {
    root.style.removeProperty(CSS_VARIABLE)
    return
  }
  if (!Number.isFinite(heightPx) || heightPx < 0) {
    console.warn(`Ignoring an invalid toast inset: ${String(heightPx)}`)
    return
  }
  root.style.setProperty(CSS_VARIABLE, `${heightPx + TOAST_INSET_GAP_PX}px`)
}

/** The `bottom` value for the toast stack, for `ToastProvider` to apply inline. */
export function toastInsetStyle(): { bottom: string } {
  return { bottom: `var(${CSS_VARIABLE}, ${DEFAULT_TOAST_INSET_PX}px)` }
}
