import { describe, expect, it } from 'vitest'
import type { ChatToolCall } from '@shared/types/chat'
import { summarizeToolCall, summarizeToolResult } from './toolCallSummary'

function call(overrides: Partial<ChatToolCall> = {}): ChatToolCall {
  return {
    id: 'tc1',
    name: 'search_jobs',
    arguments: '{}',
    status: 'done',
    result: null,
    isError: false,
    durationMs: null,
    ...overrides
  }
}

describe('summarizeToolCall', () => {
  it('summarizes search_jobs with sources', () => {
    const c = call({ arguments: JSON.stringify({ query: 'backend engineer', sources: ['indeed', 'linkedin'] }) })
    expect(summarizeToolCall(c)).toBe('Searching "backend engineer" on indeed, linkedin')
  })

  it('summarizes search_jobs without sources', () => {
    const c = call({ arguments: JSON.stringify({ query: 'backend engineer' }) })
    expect(summarizeToolCall(c)).toBe('Searching "backend engineer"')
  })

  it('falls back to the bare tool name when search_jobs has no query', () => {
    expect(summarizeToolCall(call({ arguments: '{}' }))).toBe('search_jobs')
    expect(summarizeToolCall(call({ arguments: 'not json' }))).toBe('search_jobs')
  })

  it('summarizes queue_job with title and company', () => {
    const c = call({ name: 'queue_job', arguments: JSON.stringify({ title: 'Backend Engineer', company: 'Acme' }) })
    expect(summarizeToolCall(c)).toBe('Backend Engineer at Acme')
  })

  it('summarizes queue_job with only one of title/company', () => {
    expect(summarizeToolCall(call({ name: 'queue_job', arguments: JSON.stringify({ title: 'Backend Engineer' }) }))).toBe(
      'Backend Engineer'
    )
    expect(summarizeToolCall(call({ name: 'queue_job', arguments: JSON.stringify({ company: 'Acme' }) }))).toBe('Acme')
    expect(summarizeToolCall(call({ name: 'queue_job', arguments: '{}' }))).toBe('queue_job')
  })

  it('summarizes get_job_details from the url host', () => {
    const c = call({ name: 'get_job_details', arguments: JSON.stringify({ url: 'https://jobs.example.com/posting/1' }) })
    expect(summarizeToolCall(c)).toBe('Fetching jobs.example.com')
  })

  it('falls back for get_job_details with a missing or malformed url', () => {
    expect(summarizeToolCall(call({ name: 'get_job_details', arguments: '{}' }))).toBe('get_job_details')
    expect(summarizeToolCall(call({ name: 'get_job_details', arguments: JSON.stringify({ url: 'not a url' }) }))).toBe(
      'get_job_details'
    )
  })

  it('summarizes fill_application with field count and final step', () => {
    const answers = [{ fieldId: 'a', value: '1' }, { fieldId: 'b', value: '2' }]
    expect(summarizeToolCall(call({ name: 'fill_application', arguments: JSON.stringify({ answers, finalStep: true }) }))).toBe(
      'Filling 2 fields (final step)'
    )
    expect(summarizeToolCall(call({ name: 'fill_application', arguments: JSON.stringify({ answers: [answers[0]] }) }))).toBe(
      'Filling 1 field'
    )
    expect(summarizeToolCall(call({ name: 'fill_application', arguments: '{}' }))).toBe('Filling 0 fields')
  })

  it('falls back to the tool name for an unknown tool', () => {
    expect(summarizeToolCall(call({ name: 'some_future_tool', arguments: '{}' }))).toBe('some_future_tool')
  })

  it('never throws on malformed arguments', () => {
    const inputs = ['', 'null', '[]', '{"query": 123}', '{"sources": "not-an-array"}', '{{{']
    for (const args of inputs) {
      expect(() => summarizeToolCall(call({ arguments: args }))).not.toThrow()
    }
  })
})

describe('summarizeToolResult', () => {
  it('summarizes a search_jobs result with warnings', () => {
    const c = call({
      status: 'done',
      result: JSON.stringify({ results: new Array(12).fill({}), warnings: ['a', 'b'] })
    })
    expect(summarizeToolResult(c)).toBe('12 results, 2 warnings')
  })

  it('summarizes a search_jobs result with no warnings', () => {
    const c = call({ status: 'done', result: JSON.stringify({ results: [{}], warnings: [] }) })
    expect(summarizeToolResult(c)).toBe('1 result')
  })

  it('summarizes queue_job statuses', () => {
    expect(summarizeToolResult(call({ name: 'queue_job', status: 'done', result: JSON.stringify({ status: 'queued' }) }))).toBe(
      'Queued'
    )
    expect(summarizeToolResult(call({ name: 'queue_job', status: 'done', result: JSON.stringify({ status: 'existing' }) }))).toBe(
      'Already tracked'
    )
    expect(summarizeToolResult(call({ name: 'queue_job', status: 'done', result: JSON.stringify({ status: 'excluded' }) }))).toBe(
      'Excluded'
    )
  })

  it('returns an empty string for an unrecognised tool or shape', () => {
    expect(summarizeToolResult(call({ name: 'get_job_details', status: 'done', result: '{"title":"x"}' }))).toBe('')
    expect(summarizeToolResult(call({ status: 'done', result: '{"unexpected":true}' }))).toBe('')
  })

  it('returns an empty string while pending/running, or when errored/malformed', () => {
    expect(summarizeToolResult(call({ status: 'pending_approval', result: null }))).toBe('')
    expect(summarizeToolResult(call({ status: 'running', result: null }))).toBe('')
    expect(summarizeToolResult(call({ status: 'error', result: 'boom', isError: true }))).toBe('')
    expect(summarizeToolResult(call({ status: 'done', result: 'not json' }))).toBe('')
    expect(summarizeToolResult(call({ status: 'done', result: null }))).toBe('')
  })

  it('never throws on malformed results', () => {
    const inputs = ['', 'null', '[]', '{{{', '{"results": "not-an-array"}']
    for (const result of inputs) {
      expect(() => summarizeToolResult(call({ status: 'done', result }))).not.toThrow()
    }
  })
})
