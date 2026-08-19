import { describe, it, expect } from 'vitest'
import { jsonResult, textError } from './toolResult'

describe('jsonResult', () => {
  it('wraps the value as pretty-printed JSON text content', () => {
    const result = jsonResult({ jobId: '123', status: 'queued' })
    expect(result.isError).toBeUndefined()
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify({ jobId: '123', status: 'queued' }, null, 2) }])
  })

  it('handles arrays and primitives, not just objects', () => {
    expect(jsonResult([1, 2, 3]).content[0]).toEqual({ type: 'text', text: '[\n  1,\n  2,\n  3\n]' })
    expect(jsonResult(null).content[0]).toEqual({ type: 'text', text: 'null' })
  })
})

describe('textError', () => {
  it('marks the result as an error with a plain-text message', () => {
    const result = textError('Something went wrong')
    expect(result.isError).toBe(true)
    expect(result.content).toEqual([{ type: 'text', text: 'Something went wrong' }])
  })
})
