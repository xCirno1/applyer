import { describe, it, expect } from 'vitest'
import {
  formatJson,
  humanizeKey,
  LONG_TEXT_LENGTH,
  MAX_DEPTH,
  MAX_LIST_ITEMS,
  parsePayload,
  readablePayload,
  readPayloadViewPreference,
  toReadable,
  writePayloadViewPreference
} from './toolPayloadRows'

describe('parsePayload / formatJson', () => {
  it('treats null and whitespace as empty', () => {
    expect(parsePayload(null)).toEqual({ kind: 'empty' })
    expect(parsePayload('   ')).toEqual({ kind: 'empty' })
    expect(formatJson(null)).toBe('')
  })

  it('keeps text that is not JSON instead of dropping it', () => {
    expect(parsePayload('not json {')).toEqual({ kind: 'text', text: 'not json {' })
    expect(formatJson('not json {')).toBe('not json {')
  })

  it('pretty-prints JSON', () => {
    expect(formatJson('{"a":1}')).toBe('{\n  "a": 1\n}')
  })
})

describe('humanizeKey', () => {
  it('splits camelCase and snake_case into a sentence-case label', () => {
    expect(humanizeKey('matchScore')).toBe('Match score')
    expect(humanizeKey('match_score')).toBe('Match score')
    expect(humanizeKey('desiredLocations')).toBe('Desired locations')
  })

  it('upper-cases known acronyms wherever they sit', () => {
    expect(humanizeKey('linkedinUrl')).toBe('Linkedin URL')
    expect(humanizeKey('jobId')).toBe('Job ID')
    expect(humanizeKey('url')).toBe('URL')
  })

  it('leaves a key it cannot split alone', () => {
    expect(humanizeKey('')).toBe('')
    expect(humanizeKey('___')).toBe('___')
  })
})

describe('toReadable', () => {
  it('maps primitives to text, boolean and empty rows', () => {
    expect(toReadable('hello', 'Title')).toEqual({ type: 'text', label: 'Title', text: 'hello', long: false })
    expect(toReadable(42, 'Limit')).toEqual({ type: 'text', label: 'Limit', text: '42', long: false })
    expect(toReadable(true, 'Remote')).toEqual({ type: 'boolean', label: 'Remote', value: true })
    expect(toReadable(null, 'Salary')).toEqual({ type: 'empty', label: 'Salary' })
    expect(toReadable('', 'Salary')).toEqual({ type: 'empty', label: 'Salary' })
    expect(toReadable(undefined, 'Salary')).toEqual({ type: 'empty', label: 'Salary' })
  })

  it('marks long or multi-line strings so the view can give them a scroll box', () => {
    expect(toReadable('a\nb').type === 'text' && toReadable('a\nb')).toMatchObject({ long: true })
    expect(toReadable('x'.repeat(LONG_TEXT_LENGTH))).toMatchObject({ long: true })
    expect(toReadable('x'.repeat(LONG_TEXT_LENGTH - 1))).toMatchObject({ long: false })
  })

  it('joins a short array of primitives into one row', () => {
    expect(toReadable(['greenhouse', 'lever', 3, null], 'Sources')).toEqual({
      type: 'text',
      label: 'Sources',
      text: 'greenhouse, lever, 3',
      long: false
    })
    expect(toReadable([], 'Sources')).toEqual({ type: 'empty', label: 'Sources' })
    expect(toReadable([null, ''], 'Sources')).toEqual({ type: 'empty', label: 'Sources' })
  })

  it('nests an array of objects as a numbered group', () => {
    const entry = toReadable([{ title: 'A' }, { title: 'B' }], 'Results')
    expect(entry).toEqual({
      type: 'group',
      label: 'Results',
      items: [
        { type: 'group', label: '1', items: [{ type: 'text', label: 'Title', text: 'A', long: false }] },
        { type: 'group', label: '2', items: [{ type: 'text', label: 'Title', text: 'B', long: false }] }
      ]
    })
  })

  it('humanizes object keys and folds items past the cap into one "more" row', () => {
    const big = Array.from({ length: MAX_LIST_ITEMS + 7 }, (_, i) => ({ n: i }))
    const entry = toReadable({ matchScore: 90, results: big })
    expect(entry.type).toBe('group')
    if (entry.type !== 'group') return
    expect(entry.items[0]).toEqual({ type: 'text', label: 'Match score', text: '90', long: false })
    const results = entry.items[1]
    expect(results?.type).toBe('group')
    if (results?.type !== 'group') return
    expect(results.items).toHaveLength(MAX_LIST_ITEMS + 1)
    expect(results.items[MAX_LIST_ITEMS]).toEqual({ type: 'more', count: 7 })
  })

  it('caps a long primitive array the same way', () => {
    const entry = toReadable(Array.from({ length: MAX_LIST_ITEMS + 2 }, (_, i) => `s${i}`), 'Skills')
    expect(entry.type).toBe('group')
    if (entry.type !== 'group') return
    expect(entry.items[1]).toEqual({ type: 'more', count: 2 })
  })

  it('falls back to JSON text past the depth cap instead of recursing forever', () => {
    let value: unknown = 'leaf'
    for (let i = 0; i < MAX_DEPTH + 2; i++) value = { inner: value }
    let entry = toReadable(value)
    for (let i = 0; i < MAX_DEPTH; i++) {
      expect(entry.type).toBe('group')
      if (entry.type !== 'group') return
      entry = entry.items[0]!
    }
    expect(entry.type).toBe('text')
  })

  it('never throws on values JSON.parse would not produce', () => {
    expect(toReadable(Number.NaN)).toMatchObject({ type: 'text', text: 'NaN' })
    expect(toReadable(() => 1)).toMatchObject({ type: 'text' })
    expect(toReadable(Symbol('x'))).toMatchObject({ type: 'text' })
  })
})

describe('readablePayload', () => {
  it('returns null for an empty payload and one text row for non-JSON', () => {
    expect(readablePayload(null)).toBeNull()
    expect(readablePayload('plain text')).toEqual([{ type: 'text', label: null, text: 'plain text', long: false }])
  })

  it('unwraps a top-level object into its rows, and wraps anything else', () => {
    expect(readablePayload('{"query":"react"}')).toEqual([{ type: 'text', label: 'Query', text: 'react', long: false }])
    expect(readablePayload('[1,2]')).toEqual([{ type: 'text', label: null, text: '1, 2', long: false }])
    expect(readablePayload('"just a string"')).toEqual([{ type: 'text', label: null, text: 'just a string', long: false }])
  })
})

describe('the remembered view', () => {
  function fakeStorage(initial: Record<string, string> = {}): Storage {
    const data = new Map(Object.entries(initial))
    return {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
      clear: () => data.clear(),
      key: () => null,
      length: 0
    }
  }

  it('defaults to readable and round-trips a valid choice', () => {
    const storage = fakeStorage()
    expect(readPayloadViewPreference(storage)).toBe('readable')
    writePayloadViewPreference('json', storage)
    expect(readPayloadViewPreference(storage)).toBe('json')
  })

  it('ignores a corrupt stored value and a throwing storage', () => {
    expect(readPayloadViewPreference(fakeStorage({ 'chat:toolPayloadView:v1': 'xml' }))).toBe('readable')
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    }
    expect(readPayloadViewPreference(throwing)).toBe('readable')
    expect(() => writePayloadViewPreference('json', throwing)).not.toThrow()
    expect(readPayloadViewPreference(null)).toBe('readable')
  })
})
