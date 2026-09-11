/**
 * Multi-select rules for a list of rows, as plain functions — the same
 * plain-module/component split as `dataTable.ts` beside it, for the same
 * reason: what a modifier-click does to a selection is the part worth
 * pinning down in a test, and it needs no DOM to exercise.
 *
 * The model is the one every file manager uses, so it needs no explaining in
 * the UI: a plain click selects exactly one row, Ctrl (Cmd on macOS) toggles
 * one row without disturbing the rest, and Shift selects everything between
 * the anchor and the clicked row. The anchor is the row the last plain or
 * Ctrl click landed on, which is what makes a run of Shift clicks re-span
 * from the same place rather than growing one row at a time.
 *
 * Order is always the *visible* order the caller passes in, not insertion
 * order: after sorting a table by a different column, "everything between
 * these two rows" means what is between them on screen.
 */

export interface SelectionModifiers {
  shiftKey: boolean
  /** Ctrl, or Cmd on macOS — resolved by the caller, since only it knows the platform. */
  modKey: boolean
}

export interface RowSelection {
  selected: ReadonlySet<string>
  /** Where a Shift range starts from; null before anything has been selected. */
  anchor: string | null
}

export const EMPTY_SELECTION: RowSelection = { selected: new Set(), anchor: null }

/** The keys between two rows inclusive, in visible order. */
function rangeBetween(order: readonly string[], from: string, to: string): string[] {
  const start = order.indexOf(from)
  const end = order.indexOf(to)
  if (start === -1 || end === -1) return []
  return start <= end ? order.slice(start, end + 1) : order.slice(end, start + 1)
}

/**
 * The selection after clicking (or pressing Enter/Space on) `target`.
 *
 * A target that isn't in the visible order leaves the selection untouched —
 * the list is live, and a row can be filtered or removed out from under a
 * click that is already in flight.
 */
export function nextRowSelection(
  order: readonly string[],
  state: RowSelection,
  target: string,
  modifiers: SelectionModifiers
): RowSelection {
  if (!order.includes(target)) return state

  if (modifiers.shiftKey) {
    // With no anchor yet, the clicked row becomes one rather than the Shift
    // being ignored, so the *next* Shift click has something to span from.
    const anchor = state.anchor !== null && order.includes(state.anchor) ? state.anchor : target
    const range = rangeBetween(order, anchor, target)
    // Ctrl+Shift adds the range to what is already selected; Shift alone
    // replaces the selection, so dragging the range back shrinks it.
    const selected = modifiers.modKey ? new Set([...state.selected, ...range]) : new Set(range)
    return { selected, anchor }
  }

  if (modifiers.modKey) {
    const selected = new Set(state.selected)
    if (selected.has(target)) selected.delete(target)
    else selected.add(target)
    return { selected, anchor: target }
  }

  return { selected: new Set([target]), anchor: target }
}

/**
 * The selected keys that are actually on screen, in visible order.
 *
 * Selection is kept as ids rather than pruned whenever the filter changes, so
 * narrowing the list and widening it again doesn't silently drop rows the
 * user picked. Bulk actions run over *this* instead, so they can never touch
 * a row the person can't see.
 */
export function visibleSelection(order: readonly string[], selected: ReadonlySet<string>): string[] {
  return order.filter((key) => selected.has(key))
}
