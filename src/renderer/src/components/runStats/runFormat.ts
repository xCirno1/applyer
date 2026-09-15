import { JOB_SOURCE_LABELS } from '@shared/types/jobSource'
import type { RunRecord } from '@shared/types/run'

/**
 * The Runs screen's plain formatting rules, kept out of the components so they
 * can be checked without a DOM (same split as `workspace/workspaceLayout.ts`).
 */

/** "1h 02m 05s", "4m 09s", "12s". Negative or unreadable input reads as zero. */
export function formatDuration(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (value: number): string => String(value).padStart(2, '0')
  if (hours > 0) return `${hours}h ${two(minutes)}m ${two(seconds)}s`
  if (minutes > 0) return `${minutes}m ${two(seconds)}s`
  return `${seconds}s`
}

/** Milliseconds as a short human figure: "850 ms", "3.2 s", "1m 05s". */
export function formatMillis(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 ms'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  return formatDuration(ms)
}

/** The user's label, or the default "Run #n" the caller renders from `sequence`. */
export function runDisplayName(run: Pick<RunRecord, 'label' | 'sequence'>, defaultName: (sequence: number) => string): string {
  return run.label ?? defaultName(run.sequence)
}

/**
 * A source's brand name, or the raw id for one this build does not know.
 * An own-property check rather than `in`: the id comes from whatever a run
 * recorded, and an imported job can carry a source such as `__proto__` or
 * `toString`, which `in` would resolve to an inherited object rather than
 * a label and hand React something it cannot render.
 */
export function sourceLabel(source: string): string {
  return Object.prototype.hasOwnProperty.call(JOB_SOURCE_LABELS, source)
    ? JOB_SOURCE_LABELS[source as keyof typeof JOB_SOURCE_LABELS]
    : source
}
