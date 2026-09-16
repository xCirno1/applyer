import { describe, it, expect } from 'vitest'
import { describePayload } from './toolPayloadHints'
import { MAX_LIST_ITEMS } from './toolPayloadRows'

describe('describePayload: fallbacks', () => {
  it('gives the generic rows for a tool it has no opinion on', () => {
    const hint = describePayload('get_profile', 'result', '{"fullName":"Ada"}')
    expect(hint.table).toBeNull()
    expect(hint.actions).toEqual([])
    expect(hint.rows).toEqual([{ type: 'text', label: 'Full name', text: 'Ada', long: false }])
  })

  it('gives the generic rows when a known tool returns an unexpected shape', () => {
    expect(describePayload('search_jobs', 'result', '{"error":"boom"}')).toEqual({
      table: null,
      rows: [{ type: 'text', label: 'Error', text: 'boom', long: false }],
      actions: []
    })
    expect(describePayload('search_jobs', 'result', 'not json')).toMatchObject({ table: null, actions: [] })
    expect(describePayload('search_jobs', 'result', null)).toEqual({ table: null, rows: null, actions: [] })
    expect(describePayload('search_jobs', 'result', '[1,2]')).toMatchObject({ table: null })
  })
})

describe('describePayload: search_jobs results', () => {
  it('tables the postings with the title linking to the posting, and keeps warnings as rows', () => {
    const raw = JSON.stringify({
      results: [
        { title: 'Engineer', company: 'Acme', location: 'Remote', url: 'https://acme.example/jobs/1', source: 'linkedin', salaryRange: '$100k' },
        { title: 'No link', company: 'Beta', url: 'javascript:alert(1)', source: 'indeed' }
      ],
      searchedSources: ['linkedin', 'indeed'],
      warnings: ['indeed refused headless'],
      sourceOutcomes: { linkedin: { rows: 1 } }
    })
    const hint = describePayload('search_jobs', 'result', raw)
    expect(hint.table?.columns).toEqual(['title', 'company', 'location', 'source', 'salary'])
    expect(hint.table?.rows).toEqual([
      [
        { kind: 'url', text: 'Engineer', url: 'https://acme.example/jobs/1' },
        { kind: 'text', text: 'Acme' },
        { kind: 'text', text: 'Remote' },
        { kind: 'text', text: 'linkedin' },
        { kind: 'text', text: '$100k' }
      ],
      [{ kind: 'text', text: 'No link' }, { kind: 'text', text: 'Beta' }, { kind: 'text', text: '' }, { kind: 'text', text: 'indeed' }, { kind: 'text', text: '' }]
    ])
    expect(hint.table?.hiddenCount).toBe(0)
    expect(hint.rows).toEqual([
      { type: 'text', label: 'Searched sources', text: 'linkedin, indeed', long: false },
      { type: 'text', label: 'Warnings', text: 'indeed refused headless', long: false }
    ])
  })

  it('skips malformed entries and folds rows past the cap', () => {
    const results = [...Array.from({ length: MAX_LIST_ITEMS + 3 }, (_, i) => ({ title: `Job ${i}` })), 'junk', null]
    const hint = describePayload('search_jobs', 'result', JSON.stringify({ results }))
    expect(hint.table?.rows).toHaveLength(MAX_LIST_ITEMS)
    expect(hint.table?.hiddenCount).toBe(5)
    expect(hint.rows).toBeNull()
  })
})

describe('describePayload: list_jobs results', () => {
  it('tables the jobs with the title opening the job on the board', () => {
    const raw = JSON.stringify({
      jobs: [
        { jobId: 'j1', title: 'Engineer', company: 'Acme', status: 'queued', matchScore: 88, failureTag: null },
        { title: 'Untracked', company: 'Beta', status: 'failed', failureTag: 'captcha' }
      ],
      total: 2
    })
    const hint = describePayload('list_jobs', 'result', raw)
    expect(hint.table?.columns).toEqual(['title', 'company', 'status', 'matchScore', 'failure'])
    expect(hint.table?.rows[0]).toEqual([
      { kind: 'job', text: 'Engineer', jobId: 'j1' },
      { kind: 'text', text: 'Acme' },
      { kind: 'text', text: 'queued' },
      { kind: 'text', text: '88' },
      { kind: 'text', text: '', tone: 'danger' }
    ])
    expect(hint.table?.rows[1]?.[0]).toEqual({ kind: 'text', text: 'Untracked' })
    expect(hint.table?.rows[1]?.[4]).toEqual({ kind: 'text', text: 'captcha', tone: 'danger' })
    expect(hint.rows).toEqual([{ type: 'text', label: 'Total', text: '2', long: false }])
  })
})

describe('describePayload: application forms', () => {
  it('tables inspect_application fields and adds an open-job action', () => {
    const raw = JSON.stringify({
      status: 'inspected',
      jobId: 'j1',
      fields: [
        { fieldId: 'f1', label: 'Full name', control: 'input', inputType: 'text', required: true, currentValue: 'Ada' },
        { fieldId: 'f2', name: 'skills', control: 'select', required: false, currentValue: ['a', 'b', 3] },
        { fieldId: 'f3', control: 'checkbox', required: false, currentValue: true }
      ],
      buttons: [{ buttonId: 'b1', label: 'Next' }],
      message: 'ok'
    })
    const hint = describePayload('inspect_application', 'result', raw)
    expect(hint.table?.columns).toEqual(['field', 'kind', 'required', 'value'])
    expect(hint.table?.rows).toEqual([
      [{ kind: 'text', text: 'Full name' }, { kind: 'text', text: 'input / text', tone: 'muted' }, { kind: 'bool', value: true }, { kind: 'text', text: 'Ada' }],
      [{ kind: 'text', text: 'skills' }, { kind: 'text', text: 'select', tone: 'muted' }, { kind: 'bool', value: false }, { kind: 'text', text: 'a, b' }],
      [{ kind: 'text', text: 'f3' }, { kind: 'text', text: 'checkbox', tone: 'muted' }, { kind: 'bool', value: false }, { kind: 'bool', value: true }]
    ])
    expect(hint.actions).toEqual([{ kind: 'openJob', jobId: 'j1' }])
    expect(hint.rows?.map((row) => (row.type === 'more' ? null : row.label))).toEqual(['Status', 'Job ID', 'Buttons', 'Message'])
  })

  it('tables fill_application answers from the arguments', () => {
    const raw = JSON.stringify({ jobId: 'j1', answers: [{ fieldId: 'f1', value: 'Ada' }, { fieldId: 'f2', value: true }, { fieldId: 'f3', value: ['x', 'y'] }], finalStep: true })
    const hint = describePayload('fill_application', 'arguments', raw)
    expect(hint.table?.rows).toEqual([
      [{ kind: 'text', text: 'f1' }, { kind: 'text', text: 'Ada' }],
      [{ kind: 'text', text: 'f2' }, { kind: 'bool', value: true }],
      [{ kind: 'text', text: 'f3' }, { kind: 'text', text: 'x, y' }]
    ])
    expect(hint.actions).toEqual([{ kind: 'openJob', jobId: 'j1' }])
    expect(hint.rows).toEqual([
      { type: 'text', label: 'Job ID', text: 'j1', long: false },
      { type: 'boolean', label: 'Final step', value: true }
    ])
    expect(describePayload('edit_application', 'arguments', raw).table?.rows).toHaveLength(3)
  })
})

describe('describePayload: job details and job references', () => {
  it('drops the HTML description, keeps the text one, and links the application URL', () => {
    const raw = JSON.stringify({ title: 'Engineer', description: '<p>x</p>', descriptionText: 'x', applicationUrl: 'https://acme.example/apply', requiresLogin: false })
    const hint = describePayload('get_job_details', 'result', raw)
    expect(hint.rows?.map((row) => (row.type === 'more' ? null : row.label))).toEqual(['Title', 'Description text', 'Requires login'])
    expect(hint.actions).toEqual([{ kind: 'openUrl', url: 'https://acme.example/apply' }])
  })

  it('adds an open-job action to any result naming a tracked job, but not an excluded one', () => {
    expect(describePayload('queue_job', 'result', '{"jobId":"j1","status":"queued"}').actions).toEqual([{ kind: 'openJob', jobId: 'j1' }])
    expect(describePayload('queue_job', 'result', '{"jobId":null,"status":"excluded"}').actions).toEqual([])
    expect(describePayload('flag_failure', 'arguments', '{"jobId":"j2","reasonTag":"captcha"}').actions).toEqual([{ kind: 'openJob', jobId: 'j2' }])
    expect(describePayload('flag_failure', 'arguments', '{"jobId":"   "}').actions).toEqual([])
  })
})
