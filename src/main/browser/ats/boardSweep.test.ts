import { describe, it, expect } from 'vitest'
import { boardContribution, seedContribution, selectBoardsForSweep } from './boardSweep'
import type { CompanyBoardRecord } from '@shared/types/companyBoard'

function board(token: string, overrides: Partial<CompanyBoardRecord> = {}): CompanyBoardRecord {
  return {
    id: `id-${token}`,
    boardKey: `greenhouse:${token}`,
    provider: 'greenhouse',
    token,
    host: null,
    site: null,
    companyName: token,
    addedBy: 'user',
    enabled: true,
    lastCheckedAt: null,
    lastJobCount: null,
    seedJobCount: null,
    lastError: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    ...overrides
  }
}

/** A board imported from a feed that claimed `count` roles, never fetched here. */
function seeded(token: string, count: number | null): CompanyBoardRecord {
  return board(token, { seedJobCount: count })
}

/** A board measured at `count` roles, `daysAgo` days back. */
function measured(token: string, count: number, daysAgo = 1): CompanyBoardRecord {
  const checkedAt = new Date(Date.UTC(2026, 8, 1) - daysAgo * 86400_000).toISOString()
  return board(token, { lastCheckedAt: checkedAt, lastJobCount: count })
}

const tokens = (plan: { boards: CompanyBoardRecord[] }): string[] => plan.boards.map((b) => b.token)

describe('boardContribution', () => {
  it('is what the board last held', () => {
    expect(boardContribution(measured('a', 12))).toBe(12)
  })

  it('is null for a board nothing has measured, which is not the same as empty', () => {
    expect(boardContribution(board('new'))).toBeNull()
  })

  it('is zero for a failing board, whatever count it is still carrying', () => {
    expect(boardContribution(board('broken', { lastCheckedAt: '2026-08-30T00:00:00.000Z', lastJobCount: 90, lastError: 'boom' }))).toBe(0)
  })

  it('is null for a board that was reached by a request that could not count it', () => {
    // A Workday board only ever visited by keyword searches: contacted, so it
    // has a last-checked time, but nothing has ever asked it how big it is.
    // Reading that as zero would park it at the bottom of every later sweep.
    expect(boardContribution(board('wd', { lastCheckedAt: '2026-08-30T00:00:00.000Z', lastJobCount: null }))).toBeNull()
  })

  it('treats a nonsense stored count as zero rather than trusting it', () => {
    expect(boardContribution(board('odd', { lastCheckedAt: '2026-08-30T00:00:00.000Z', lastJobCount: -5 }))).toBe(0)
    expect(boardContribution(board('odd', { lastCheckedAt: '2026-08-30T00:00:00.000Z', lastJobCount: NaN }))).toBe(0)
  })
})

describe('seedContribution', () => {
  it('is what the feed claimed', () => {
    expect(seedContribution(seeded('a', 480))).toBe(480)
  })

  it('is below every real claim when a board came from nowhere', () => {
    expect(seedContribution(seeded('none', null))).toBeLessThan(seedContribution(seeded('empty', 0)))
  })

  it('refuses a claim no board could have', () => {
    expect(seedContribution(seeded('odd', -5))).toBe(-1)
    expect(seedContribution(seeded('odd', NaN))).toBe(-1)
  })
})

describe('selectBoardsForSweep', () => {
  it('fetches everything when the watchlist fits, biggest first', () => {
    const plan = selectBoardsForSweep([measured('small', 2), measured('big', 90), measured('mid', 20)], 25)

    expect(tokens(plan)).toEqual(['big', 'mid', 'small'])
    expect(plan.skipped).toBe(0)
  })

  it('spends most of the budget on the boards carrying the most roles', () => {
    const tracked = [
      measured('tiny', 1),
      measured('huge', 500),
      measured('big', 300),
      measured('mid', 50),
      measured('small', 5)
    ]

    // Budget of 4 → 3 by size, 1 reserved for rotation.
    const plan = selectBoardsForSweep(tracked, 4)

    expect(plan.pickedBySize).toBe(3)
    expect(plan.pickedByRotation).toBe(1)
    expect(tokens(plan).slice(0, 3)).toEqual(['huge', 'big', 'mid'])
    expect(plan.skipped).toBe(1)
  })

  it('reserves a slot for a board nothing has measured, which size alone would starve forever', () => {
    // Without rotation, `fresh` has no size, so it is never picked, so it
    // never gets one — the self-fulfilling case this exists to break.
    const tracked = [measured('a', 90), measured('b', 80), measured('c', 70), measured('d', 60), board('fresh')]

    const plan = selectBoardsForSweep(tracked, 4)

    expect(tokens(plan)).toContain('fresh')
  })

  it('measures a freshly imported watchlist a batch at a time instead of leaving it unknown', () => {
    const tracked = Array.from({ length: 10 }, (_, i) => board(`new-${i}`))

    const plan = selectBoardsForSweep(tracked, 4)

    // Nothing can be ranked by size yet, so the whole budget goes to rotation
    // rather than being left unspent.
    expect(plan.boards).toHaveLength(4)
    expect(plan.pickedByRotation).toBe(4)
    expect(plan.pickedBySize).toBe(0)
  })

  it('rotates through the boards nothing has looked at in longest', () => {
    const tracked = [
      measured('big', 500, 1),
      measured('stale', 3, 90),
      measured('fresher', 4, 2),
      measured('freshest', 5, 1)
    ]

    // 2 by size (big, freshest), 1 by rotation — which must be the one
    // untouched for 90 days, not simply the next by size.
    const plan = selectBoardsForSweep(tracked, 3)

    expect(tokens(plan)).toContain('stale')
    expect(tokens(plan)).toContain('big')
  })

  it('brings a failing board back through rotation rather than every search', () => {
    const failing = board('broken', {
      lastCheckedAt: '2026-06-01T00:00:00.000Z',
      lastJobCount: 0,
      lastError: 'timed out'
    })
    const tracked = [measured('a', 90), measured('b', 80), measured('c', 70), failing]

    // It contributes nothing, so it is never picked for size…
    const plan = selectBoardsForSweep(tracked, 3)
    expect(plan.boards.filter((b) => b.token === 'broken')).toHaveLength(1)
    expect(plan.pickedBySize).toBe(2)

    // …but with the others checked more recently, it is the stalest, so it is
    // retried instead of being written off permanently.
    expect(tokens(plan)).toContain('broken')
  })

  it('sweeps a freshly imported watchlist by what the feed said it holds', () => {
    // The case a bulk CSV import creates: hundreds of boards, none measured,
    // so staleness ties for every one of them. Ordering that tie by board key
    // would spend the first sweeps on whatever sorts first alphabetically —
    // and postings per board are skewed enough that the difference is most of
    // the postings in the file.
    const tracked = [seeded('aaa-tiny', 2), seeded('zzz-huge', 900), seeded('mmm-mid', 100)]

    const plan = selectBoardsForSweep(tracked, 2)

    expect(tokens(plan)).toEqual(['zzz-huge', 'mmm-mid'])
  })

  it('prefers a board it has measured over a bigger claim it has not', () => {
    // A claim is a third-party file; a measurement is this app asking the
    // board. Even an empty measured board outranks a claimed 900 for the size
    // slots — the claim only orders boards that have no reading at all.
    const tracked = [measured('measured-empty', 0), seeded('claimed-huge', 900), seeded('claimed-small', 1)]

    const plan = selectBoardsForSweep(tracked, 2)

    expect(plan.pickedBySize).toBe(1)
    expect(tokens(plan)).toEqual(['measured-empty', 'claimed-huge'])
  })

  it('falls back to board key when nothing claimed anything', () => {
    const tracked = [board('c'), board('a'), board('b')]
    expect(tokens(selectBoardsForSweep(tracked, 2))).toEqual(['a', 'b'])
  })

  it('stops using a claim once the board has been fetched', () => {
    // `big-claim` was imported claiming 900 and turned out to hold 1; the
    // reading is what ranks it from then on, so it must not keep leading the
    // sweep on a number that has been disproved.
    const tracked = [measured('big-claim', 1, 1), measured('real', 50, 1), seeded('unmeasured', 900)]
    const plan = selectBoardsForSweep(tracked, 2)

    expect(tokens(plan)).toEqual(['real', 'unmeasured'])
  })

  it('is deterministic when boards are indistinguishable', () => {
    const tracked = [measured('c', 10), measured('a', 10), measured('b', 10)]
    expect(tokens(selectBoardsForSweep(tracked, 2))).toEqual(tokens(selectBoardsForSweep(tracked, 2)))
  })

  it('always leaves at least one slot for size and one for rotation', () => {
    const tracked = [measured('big', 90), measured('mid', 50), board('fresh')]
    const plan = selectBoardsForSweep(tracked, 2)

    expect(plan.pickedBySize).toBe(1)
    expect(plan.pickedByRotation).toBe(1)
    expect(tokens(plan)).toEqual(['big', 'fresh'])
  })

  it('handles an empty watchlist and a zero budget', () => {
    expect(selectBoardsForSweep([], 25)).toEqual({ boards: [], skipped: 0, pickedBySize: 0, pickedByRotation: 0 })
    expect(selectBoardsForSweep([measured('a', 1)], 0)).toEqual({
      boards: [],
      skipped: 1,
      pickedBySize: 0,
      pickedByRotation: 0
    })
  })

  it('never picks the same board twice', () => {
    const tracked = [measured('a', 90), board('b'), measured('c', 10), board('d')]
    const plan = selectBoardsForSweep(tracked, 3)
    expect(new Set(tokens(plan)).size).toBe(plan.boards.length)
  })
})
