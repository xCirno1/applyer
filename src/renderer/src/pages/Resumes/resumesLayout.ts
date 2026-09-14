// The Resume Variants screen's column widths: the variant list on the left
// and the details column on the right, both dragged by a `ResizeHandle`.
// Persisted per browser like `workspace/workspaceLayout.ts`, and for the
// same reason: a width the user set should not snap back on remount.
//
// No React here so the clamp/parse rules are testable without a DOM.

export interface ResumesLayout {
  /** Variant list width in px (Variants tab only). */
  listWidth: number
  /** Details column width in px (Variants and Master tabs share it). */
  detailsWidth: number
}

export const RESUMES_LAYOUT_STORAGE_KEY = 'resumes:layout:v1'

export const LIST_MIN_PX = 200
export const LIST_MAX_PX = 480
export const DETAILS_MIN_PX = 240
export const DETAILS_MAX_PX = 560

/** What the middle column (preview/editor) always keeps when a neighbour is dragged toward it. */
const MIN_WORK_AREA_PX = 360

export const DEFAULT_RESUMES_LAYOUT: ResumesLayout = { listWidth: 288, detailsWidth: 320 }

function clampBetween(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

/** @param available Total row width; @param other the width of the opposite side column, so both cannot squeeze the middle out. */
export function clampListWidth(width: number, available?: number, other = 0): number {
  const ceiling = Number.isFinite(available) ? Math.min(LIST_MAX_PX, (available as number) - other - MIN_WORK_AREA_PX) : LIST_MAX_PX
  return Math.round(clampBetween(width, LIST_MIN_PX, ceiling))
}

export function clampDetailsWidth(width: number, available?: number, other = 0): number {
  const ceiling = Number.isFinite(available)
    ? Math.min(DETAILS_MAX_PX, (available as number) - other - MIN_WORK_AREA_PX)
    : DETAILS_MAX_PX
  return Math.round(clampBetween(width, DETAILS_MIN_PX, ceiling))
}

/** Rebuilds a layout from storage, field by field; user-writable storage is never trusted into a style attribute. */
export function parseResumesLayout(raw: unknown): ResumesLayout {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_RESUMES_LAYOUT
  const value = raw as Record<string, unknown>
  const size = (key: keyof ResumesLayout, fallback: number, clamp: (n: number) => number): number => {
    const parsed = Number(value[key])
    return clamp(Number.isFinite(parsed) ? parsed : fallback)
  }
  return {
    listWidth: size('listWidth', DEFAULT_RESUMES_LAYOUT.listWidth, clampListWidth),
    detailsWidth: size('detailsWidth', DEFAULT_RESUMES_LAYOUT.detailsWidth, clampDetailsWidth)
  }
}

export function readStoredResumesLayout(): ResumesLayout {
  try {
    const raw = window.localStorage.getItem(RESUMES_LAYOUT_STORAGE_KEY)
    if (!raw) return DEFAULT_RESUMES_LAYOUT
    return parseResumesLayout(JSON.parse(raw))
  } catch {
    // Disabled storage or malformed JSON: the defaults are fine for this session.
    return DEFAULT_RESUMES_LAYOUT
  }
}

export function writeStoredResumesLayout(layout: ResumesLayout): void {
  try {
    window.localStorage.setItem(RESUMES_LAYOUT_STORAGE_KEY, JSON.stringify(layout))
  } catch {
    // Same reasoning as the read.
  }
}
