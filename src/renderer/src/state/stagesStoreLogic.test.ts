import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ApplicationStage } from '@shared/types/applicationStage'
import {
  STAGE_FILTER_ALL,
  STAGE_FILTER_NONE,
  builtinStageKey,
  coerceStageFilter,
  customStageCount,
  findJobStage,
  indexStages,
  jobMatchesStageFilter,
  resetUnknownStageWarnings,
  stageCountRows,
  stageFilterToQuery,
  stageTargets
} from './stagesStoreLogic'

const OFFER: ApplicationStage = { id: 'offer', label: 'Offer', isBuiltin: true, position: 0 }
const PHONE: ApplicationStage = { id: 'uuid-phone', label: 'Phone screen', isBuiltin: false, position: 1 }
const STAGES = [OFFER, PHONE]

beforeEach(() => {
  resetUnknownStageWarnings()
})

describe('stage filter', () => {
  it('turns the filter into the Submitted query', () => {
    expect(stageFilterToQuery(STAGE_FILTER_ALL)).toBeUndefined()
    expect(stageFilterToQuery(STAGE_FILTER_NONE)).toBeNull()
    expect(stageFilterToQuery('offer')).toBe('offer')
  })

  it('only ever filters Submitted jobs', () => {
    expect(jobMatchesStageFilter({ status: 'queued', stageId: null }, 'offer')).toBe(true)
    expect(jobMatchesStageFilter({ status: 'submitted', stageId: 'offer' }, STAGE_FILTER_ALL)).toBe(true)
    expect(jobMatchesStageFilter({ status: 'submitted', stageId: 'offer' }, 'offer')).toBe(true)
    expect(jobMatchesStageFilter({ status: 'submitted', stageId: 'rejected' }, 'offer')).toBe(false)
    expect(jobMatchesStageFilter({ status: 'submitted', stageId: null }, STAGE_FILTER_NONE)).toBe(true)
    expect(jobMatchesStageFilter({ status: 'submitted', stageId: 'offer' }, STAGE_FILTER_NONE)).toBe(false)
  })

  it('falls back to every stage when the filtered stage is gone', () => {
    expect(coerceStageFilter('offer', STAGES)).toBe('offer')
    expect(coerceStageFilter('deleted', STAGES)).toBe(STAGE_FILTER_ALL)
    expect(coerceStageFilter(STAGE_FILTER_NONE, [])).toBe(STAGE_FILTER_NONE)
    expect(coerceStageFilter(STAGE_FILTER_ALL, [])).toBe(STAGE_FILTER_ALL)
  })
})

describe('labels and lookup', () => {
  it('names the built-in to translate, and nothing for a custom stage', () => {
    expect(builtinStageKey(OFFER)).toBe('offer')
    expect(builtinStageKey(PHONE)).toBeNull()
    // A row flagged built-in with an id this build does not know shows its stored label.
    expect(builtinStageKey({ id: 'hired', isBuiltin: true })).toBeNull()
  })

  it('finds a job stage, treating an unknown id as none and warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const byId = indexStages(STAGES)
    expect(findJobStage('offer', byId, true)).toBe(OFFER)
    expect(findJobStage(null, byId, true)).toBeNull()
    expect(findJobStage('ghost', byId, true)).toBeNull()
    expect(findJobStage('ghost', byId, true)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not warn while the list has not loaded yet', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(findJobStage('offer', new Map(), false)).toBeNull()
    expect(warn).not.toHaveBeenCalled()
  })

  it('counts custom stages', () => {
    expect(customStageCount(STAGES)).toBe(1)
    expect(customStageCount([])).toBe(0)
  })
})

describe('stageTargets', () => {
  it('keeps only Submitted jobs and counts the rest as skipped', () => {
    expect(
      stageTargets([
        { id: 'a', status: 'submitted', stageId: 'offer' },
        { id: 'b', status: 'queued', stageId: null },
        { id: 'c', status: 'submitted', stageId: 'offer' }
      ])
    ).toEqual({ ids: ['a', 'c'], skipped: 1, current: 'offer' })
  })

  it('reports no shared stage when they differ, and null when none has one', () => {
    expect(
      stageTargets([
        { id: 'a', status: 'submitted', stageId: 'offer' },
        { id: 'b', status: 'submitted', stageId: null }
      ]).current
    ).toBeUndefined()
    expect(stageTargets([{ id: 'a', status: 'submitted', stageId: null }]).current).toBeNull()
    expect(stageTargets([{ id: 'a', status: 'failed', stageId: null }])).toEqual({ ids: [], skipped: 1, current: undefined })
  })
})

describe('stageCountRows', () => {
  it('lists every stage in order, zero-filled, then the no-stage bucket', () => {
    const { rows, total } = stageCountRows(STAGES, [
      { stageId: 'uuid-phone', count: 2 },
      { stageId: null, count: 3 }
    ])
    expect(rows).toEqual([
      { stage: OFFER, count: 0 },
      { stage: PHONE, count: 2 },
      { stage: null, count: 3 }
    ])
    expect(total).toBe(5)
  })

  it('folds counts for unknown stages into no stage', () => {
    const { rows } = stageCountRows(STAGES, [
      { stageId: 'ghost', count: 4 },
      { stageId: null, count: 1 }
    ])
    expect(rows.at(-1)).toEqual({ stage: null, count: 5 })
  })

  it('still has the no-stage row with nothing loaded', () => {
    expect(stageCountRows([], [])).toEqual({ rows: [{ stage: null, count: 0 }], total: 0 })
  })
})
