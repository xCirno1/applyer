import { describe, it, expect, vi, beforeEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { createTestDb } from '../testDb'
import type * as schema from '../schema'

let testDb: ReturnType<typeof drizzle<typeof schema>>
vi.mock('../index', () => ({ getDb: () => testDb }))

beforeEach(() => {
  testDb = createTestDb().db
})

import { listFailureTags, ensureFailureTag } from './failureTagsRepository'

describe('listFailureTags', () => {
  it('starts empty (the app seeds builtins separately at startup, not in migrations)', () => {
    expect(listFailureTags()).toEqual([])
  })
})

describe('ensureFailureTag', () => {
  it('registers a new tag id with a humanized label', () => {
    ensureFailureTag('login_required')
    const tags = listFailureTags()
    expect(tags).toHaveLength(1)
    expect(tags[0]).toEqual({ id: 'login_required', label: 'Login Required', description: null, isBuiltin: false })
  })

  it('humanizes multi-word snake_case ids, capitalizing each part', () => {
    ensureFailureTag('needs_manual_review')
    expect(listFailureTags()[0]!.label).toBe('Needs Manual Review')
  })

  it('is idempotent: calling it again for the same id does not duplicate or overwrite', () => {
    ensureFailureTag('other')
    ensureFailureTag('other')
    const tags = listFailureTags()
    expect(tags.filter((t) => t.id === 'other')).toHaveLength(1)
  })

  it('does not touch an existing tag even if it already has a description', () => {
    // Simulate a pre-seeded builtin tag with a description, the way
    // db/index.ts's seedFailureTags does at startup.
    ensureFailureTag('captcha_verification')
    ensureFailureTag('captcha_verification')
    const tag = listFailureTags().find((t) => t.id === 'captcha_verification')
    expect(tag?.description).toBeNull()
  })
})
