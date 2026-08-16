import { eq } from 'drizzle-orm'
import { getDb } from '../index'
import { failureTags } from '../schema'
import type { FailureTag } from '@shared/types/job'

function humanizeTagId(id: string): string {
  return id
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ')
}

export function listFailureTags(): FailureTag[] {
  return getDb()
    .select()
    .from(failureTags)
    .all()
    .map((row) => ({ id: row.id, label: row.label, description: row.description, isBuiltin: row.isBuiltin }))
}

/** Auto-registers a failure tag id the first time it's used, so the tag system stays extensible without code changes. */
export function ensureFailureTag(id: string): void {
  const db = getDb()
  const existing = db.select().from(failureTags).where(eq(failureTags.id, id)).get()
  if (existing) return

  db.insert(failureTags)
    .values({ id, label: humanizeTagId(id), description: null, isBuiltin: false })
    .onConflictDoNothing({ target: failureTags.id })
    .run()
}
