import { describe, it, expect } from 'vitest'
import {
  BUILTIN_STAGE_IDS,
  BUILTIN_STAGE_LABELS,
  STAGE_LABEL_MAX_LENGTH,
  applyStageOrder,
  checkStageLabel,
  findStageByReference,
  isBuiltinStageId,
  isStageLabelTaken,
  moveStage,
  normalizeStageLabel,
  sanitizeStageCounts,
  sanitizeStages,
  stageNameKey,
  type ApplicationStage
} from './applicationStage'

function builtins(): ApplicationStage[] {
  return BUILTIN_STAGE_IDS.map((id, position) => ({ id, label: BUILTIN_STAGE_LABELS[id], isBuiltin: true, position }))
}

const PHONE: ApplicationStage = { id: 'uuid-phone', label: 'Phone screen', isBuiltin: false, position: 5 }

describe('built-in stages', () => {
  it('has an English label for every id, and recognises only those ids', () => {
    for (const id of BUILTIN_STAGE_IDS) {
      expect(BUILTIN_STAGE_LABELS[id].length).toBeGreaterThan(0)
      expect(isBuiltinStageId(id)).toBe(true)
    }
    expect(isBuiltinStageId('phone_screen')).toBe(false)
    expect(isBuiltinStageId(42)).toBe(false)
    expect(isBuiltinStageId(null)).toBe(false)
  })
})

describe('checkStageLabel', () => {
  it('normalises whitespace and accepts a label at the limit', () => {
    expect(normalizeStageLabel('  Phone \n  screen ')).toBe('Phone screen')
    expect(checkStageLabel('  Phone   screen ')).toEqual({ ok: true, label: 'Phone screen' })
    const atLimit = 'x'.repeat(STAGE_LABEL_MAX_LENGTH)
    expect(checkStageLabel(atLimit)).toEqual({ ok: true, label: atLimit })
  })

  it('refuses empty, whitespace-only, too long and non-string labels', () => {
    expect(checkStageLabel('')).toEqual({ ok: false, problem: 'empty' })
    expect(checkStageLabel('   \t ')).toEqual({ ok: false, problem: 'empty' })
    expect(checkStageLabel('x'.repeat(STAGE_LABEL_MAX_LENGTH + 1))).toEqual({ ok: false, problem: 'tooLong' })
    expect(checkStageLabel(undefined)).toEqual({ ok: false, problem: 'empty' })
    expect(checkStageLabel(12)).toEqual({ ok: false, problem: 'empty' })
  })
})

describe('findStageByReference', () => {
  const stages = [...builtins(), PHONE]

  it('matches an id, a built-in id case-insensitively, or a label case-insensitively', () => {
    expect(findStageByReference(stages, 'uuid-phone')).toBe(PHONE)
    expect(findStageByReference(stages, 'INTERVIEWING')?.id).toBe('interviewing')
    expect(findStageByReference(stages, 'awaiting response')?.id).toBe('awaiting_response')
    expect(findStageByReference(stages, '  phone   SCREEN ')).toBe(PHONE)
  })

  it('returns null for nothing, or a blank reference', () => {
    expect(findStageByReference(stages, 'Hired')).toBeNull()
    expect(findStageByReference(stages, '   ')).toBeNull()
    expect(findStageByReference([], 'Offer')).toBeNull()
  })
})

describe('isStageLabelTaken', () => {
  const stages = [...builtins(), PHONE]

  it('clashes with built-in labels and ids and with custom labels, case-insensitively', () => {
    expect(isStageLabelTaken(stages, 'offer')).toBe(true)
    expect(isStageLabelTaken(stages, 'Awaiting_Response')).toBe(true)
    expect(isStageLabelTaken(stages, 'PHONE SCREEN')).toBe(true)
    expect(isStageLabelTaken(stages, 'Onsite')).toBe(false)
  })

  it('ignores the stage being renamed, so a case-only rename is allowed', () => {
    expect(isStageLabelTaken(stages, 'phone screen', PHONE.id)).toBe(false)
  })

  it('compares on the normalised key', () => {
    expect(stageNameKey('  Phone  Screen ')).toBe('phone screen')
  })
})

describe('sanitizeStages', () => {
  it('drops malformed entries and sorts by position', () => {
    const result = sanitizeStages([
      { id: 'b', label: 'B', isBuiltin: false, position: 2, extra: 'dropped' },
      { id: 'a', label: 'A', isBuiltin: true, position: 0 },
      { id: '', label: 'Empty id', isBuiltin: false, position: 1 },
      { id: 'c', label: 3, isBuiltin: false, position: 1 },
      { id: 'd', label: 'D', isBuiltin: 'no', position: 1 },
      { id: 'e', label: 'E', isBuiltin: false, position: Number.NaN },
      null,
      'stage'
    ])
    expect(result).toEqual([
      { id: 'a', label: 'A', isBuiltin: true, position: 0 },
      { id: 'b', label: 'B', isBuiltin: false, position: 2 }
    ])
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(sanitizeStages(undefined)).toEqual([])
    expect(sanitizeStages({ stages: [] })).toEqual([])
  })
})

describe('sanitizeStageCounts', () => {
  it('keeps readable counts, including the no-stage bucket, and drops the rest', () => {
    expect(
      sanitizeStageCounts([
        { stageId: 'offer', count: 2 },
        { stageId: null, count: 0 },
        { stageId: 'x', count: -1 },
        { stageId: 'y', count: 1.5 },
        { stageId: 3, count: 1 },
        null
      ])
    ).toEqual([
      { stageId: 'offer', count: 2 },
      { stageId: null, count: 0 }
    ])
    expect(sanitizeStageCounts('nope')).toEqual([])
  })
})

describe('applyStageOrder', () => {
  const stages: ApplicationStage[] = [
    { id: 'a', label: 'A', isBuiltin: true, position: 0 },
    { id: 'b', label: 'B', isBuiltin: false, position: 1 },
    { id: 'c', label: 'C', isBuiltin: false, position: 2 }
  ]

  it('applies a full order with dense positions', () => {
    expect(applyStageOrder(stages, ['c', 'a', 'b']).map((s) => [s.id, s.position])).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2]
    ])
  })

  it('ignores unknown and repeated ids and appends stages the order left out, in their current order', () => {
    expect(applyStageOrder(stages, ['ghost', 'c', 'c']).map((s) => s.id)).toEqual(['c', 'a', 'b'])
    expect(applyStageOrder(stages, []).map((s) => s.id)).toEqual(['a', 'b', 'c'])
  })

  it('closes gaps left by a deletion', () => {
    const gappy = [
      { ...stages[0]!, position: 0 },
      { ...stages[2]!, position: 7 }
    ]
    expect(applyStageOrder(gappy, []).map((s) => s.position)).toEqual([0, 1])
  })
})

describe('moveStage', () => {
  const stages: ApplicationStage[] = [
    { id: 'a', label: 'A', isBuiltin: true, position: 0 },
    { id: 'b', label: 'B', isBuiltin: false, position: 1 },
    { id: 'c', label: 'C', isBuiltin: false, position: 2 }
  ]

  it('moves a stage up or down by one', () => {
    expect(moveStage(stages, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveStage(stages, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('clamps at either end and leaves an unknown id alone', () => {
    expect(moveStage(stages, 'a', -1)).toEqual(['a', 'b', 'c'])
    expect(moveStage(stages, 'c', 5)).toEqual(['a', 'b', 'c'])
    expect(moveStage(stages, 'ghost', 1)).toEqual(['a', 'b', 'c'])
  })
})
