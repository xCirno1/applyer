import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  searchJobsShape,
  getJobDetailsShape,
  queueJobShape,
  listJobsShape,
  flagFailureShape,
  getProfileShape,
  updateProfileShape,
  fillApplicationShape,
  excludeJobShape,
  addCompanyBoardShape,
  listCompanyBoardsShape
} from './schemas'

const searchJobsSchema = z.object(searchJobsShape)
const getJobDetailsSchema = z.object(getJobDetailsShape)
const queueJobSchema = z.object(queueJobShape)
const listJobsSchema = z.object(listJobsShape)
const flagFailureSchema = z.object(flagFailureShape)
const getProfileSchema = z.object(getProfileShape)
const updateProfileSchema = z.object(updateProfileShape)
const fillApplicationSchema = z.object(fillApplicationShape)
const excludeJobSchema = z.object(excludeJobShape)
const addCompanyBoardSchema = z.object(addCompanyBoardShape)
const listCompanyBoardsSchema = z.object(listCompanyBoardsShape)

describe('searchJobsShape', () => {
  it('accepts a minimal valid call (query only)', () => {
    expect(searchJobsSchema.safeParse({ query: 'engineer' }).success).toBe(true)
  })

  it('rejects an empty query', () => {
    expect(searchJobsSchema.safeParse({ query: '' }).success).toBe(false)
  })

  it('rejects a query over 200 chars', () => {
    expect(searchJobsSchema.safeParse({ query: 'a'.repeat(201) }).success).toBe(false)
  })

  it('trims whitespace from query', () => {
    const result = searchJobsSchema.parse({ query: '  engineer  ' })
    expect(result.query).toBe('engineer')
  })

  it('rejects an unknown jobType enum value', () => {
    expect(searchJobsSchema.safeParse({ query: 'x', jobType: 'seasonal' }).success).toBe(false)
  })

  it('rejects an unknown source', () => {
    expect(searchJobsSchema.safeParse({ query: 'x', sources: ['monster'] }).success).toBe(false)
  })

  it('rejects a limit outside [1, 50]', () => {
    expect(searchJobsSchema.safeParse({ query: 'x', limit: 0 }).success).toBe(false)
    expect(searchJobsSchema.safeParse({ query: 'x', limit: 51 }).success).toBe(false)
    expect(searchJobsSchema.safeParse({ query: 'x', limit: 1.5 }).success).toBe(false)
  })

  it('accepts the boundary limits 1 and 50', () => {
    expect(searchJobsSchema.safeParse({ query: 'x', limit: 1 }).success).toBe(true)
    expect(searchJobsSchema.safeParse({ query: 'x', limit: 50 }).success).toBe(true)
  })
})

describe('getJobDetailsShape', () => {
  it('requires a valid URL', () => {
    expect(getJobDetailsSchema.safeParse({ url: 'https://example.com/job/1' }).success).toBe(true)
    expect(getJobDetailsSchema.safeParse({ url: 'not-a-url' }).success).toBe(false)
    expect(getJobDetailsSchema.safeParse({}).success).toBe(false)
  })
})

describe('queueJobShape', () => {
  const base = { title: 'Engineer', company: 'Acme', url: 'https://example.com/1' }

  it('accepts the minimal required fields', () => {
    expect(queueJobSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a missing/blank title or company', () => {
    expect(queueJobSchema.safeParse({ ...base, title: '' }).success).toBe(false)
    expect(queueJobSchema.safeParse({ ...base, company: '   ' }).success).toBe(false)
  })

  it('rejects an invalid url', () => {
    expect(queueJobSchema.safeParse({ ...base, url: 'nope' }).success).toBe(false)
  })

  it('rejects matchScore outside [0, 100]', () => {
    expect(queueJobSchema.safeParse({ ...base, matchScore: -1 }).success).toBe(false)
    expect(queueJobSchema.safeParse({ ...base, matchScore: 101 }).success).toBe(false)
    expect(queueJobSchema.safeParse({ ...base, matchScore: 100 }).success).toBe(true)
  })

  it('caps matchReasons at 5 entries', () => {
    expect(queueJobSchema.safeParse({ ...base, matchReasons: Array(5).fill('reason') }).success).toBe(true)
    expect(queueJobSchema.safeParse({ ...base, matchReasons: Array(6).fill('reason') }).success).toBe(false)
  })

  it('rejects a description over 50000 chars', () => {
    expect(queueJobSchema.safeParse({ ...base, description: 'a'.repeat(50001) }).success).toBe(false)
  })
})

describe('listJobsShape', () => {
  it('accepts an empty query (all fields optional)', () => {
    expect(listJobsSchema.safeParse({}).success).toBe(true)
  })

  it('rejects an unknown status', () => {
    expect(listJobsSchema.safeParse({ status: 'archived' }).success).toBe(false)
  })

  it('rejects a negative offset', () => {
    expect(listJobsSchema.safeParse({ offset: -1 }).success).toBe(false)
    expect(listJobsSchema.safeParse({ offset: 0 }).success).toBe(true)
  })
})

describe('flagFailureShape', () => {
  const base = { jobId: 'job-1', reasonTag: 'login_required' }

  it('accepts a well-formed reasonTag', () => {
    expect(flagFailureSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a reasonTag with uppercase, spaces, or leading digits', () => {
    expect(flagFailureSchema.safeParse({ ...base, reasonTag: 'Login_Required' }).success).toBe(false)
    expect(flagFailureSchema.safeParse({ ...base, reasonTag: 'login required' }).success).toBe(false)
    expect(flagFailureSchema.safeParse({ ...base, reasonTag: '1login' }).success).toBe(false)
  })

  it('rejects a reasonTag that is too short (1 char)', () => {
    expect(flagFailureSchema.safeParse({ ...base, reasonTag: 'a' }).success).toBe(false)
  })

  it('rejects an empty jobId', () => {
    expect(flagFailureSchema.safeParse({ ...base, jobId: '' }).success).toBe(false)
  })

  it('rejects a message over 500 chars', () => {
    expect(flagFailureSchema.safeParse({ ...base, message: 'a'.repeat(501) }).success).toBe(false)
  })
})

describe('getProfileShape', () => {
  it('accepts an empty object (no args)', () => {
    expect(getProfileSchema.safeParse({}).success).toBe(true)
  })
})

describe('fillApplicationShape', () => {
  it('requires a non-empty jobId', () => {
    expect(fillApplicationSchema.safeParse({ jobId: 'job-1' }).success).toBe(true)
    expect(fillApplicationSchema.safeParse({ jobId: '' }).success).toBe(false)
    expect(fillApplicationSchema.safeParse({}).success).toBe(false)
  })
})

describe('excludeJobShape', () => {
  it('requires a valid url; title/company/reason are optional', () => {
    expect(excludeJobSchema.safeParse({ url: 'https://example.com/1' }).success).toBe(true)
    expect(excludeJobSchema.safeParse({ url: 'not-a-url' }).success).toBe(false)
  })

  it('rejects an over-long title/company/reason', () => {
    expect(excludeJobSchema.safeParse({ url: 'https://example.com/1', title: 'a'.repeat(301) }).success).toBe(false)
  })
})

describe('updateProfileShape', () => {
  it('accepts an empty object (the tool itself rejects a no-op call, not the schema)', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a partial update of a single field', () => {
    expect(updateProfileSchema.safeParse({ summary: 'Backend engineer.' }).success).toBe(true)
  })

  it('accepts an empty-string email (clearing it) but rejects a malformed one', () => {
    expect(updateProfileSchema.safeParse({ email: '' }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ email: 'jane@example.com' }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ email: 'not-an-email' }).success).toBe(false)
  })

  it('accepts null for the nullable numerics, rejects a non-integer or out-of-range one', () => {
    expect(updateProfileSchema.safeParse({ salaryMin: null, yearsExperience: null }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ yearsExperience: 81 }).success).toBe(false)
    expect(updateProfileSchema.safeParse({ yearsExperience: -1 }).success).toBe(false)
    expect(updateProfileSchema.safeParse({ salaryMin: 1.5 }).success).toBe(false)
    expect(updateProfileSchema.safeParse({ salaryMax: 10_000_001 }).success).toBe(false)
  })

  it('rejects an unknown remotePreference', () => {
    expect(updateProfileSchema.safeParse({ remotePreference: 'remote' }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ remotePreference: 'sometimes' }).success).toBe(false)
  })

  it('caps list length and entry length', () => {
    expect(updateProfileSchema.safeParse({ skills: Array(100).fill('x') }).success).toBe(true)
    expect(updateProfileSchema.safeParse({ skills: Array(101).fill('x') }).success).toBe(false)
    expect(updateProfileSchema.safeParse({ skills: ['x'.repeat(101)] }).success).toBe(false)
    expect(updateProfileSchema.safeParse({ desiredRoles: Array(21).fill('x') }).success).toBe(false)
  })

  it('rejects a summary over 5000 chars', () => {
    expect(updateProfileSchema.safeParse({ summary: 'a'.repeat(5001) }).success).toBe(false)
  })

  it('trims string fields and list entries', () => {
    const parsed = updateProfileSchema.parse({ fullName: '  Jane Doe  ', skills: ['  Go  '] })
    expect(parsed.fullName).toBe('Jane Doe')
    expect(parsed.skills).toEqual(['Go'])
  })
})

describe('addCompanyBoardShape', () => {
  it('accepts a bare company name, domain, or board URL', () => {
    expect(addCompanyBoardSchema.safeParse({ company: 'Acme Labs' }).success).toBe(true)
    expect(addCompanyBoardSchema.safeParse({ company: 'acme.com' }).success).toBe(true)
    expect(addCompanyBoardSchema.safeParse({ company: 'https://jobs.lever.co/acme' }).success).toBe(true)
  })

  it('rejects a missing or blank company', () => {
    expect(addCompanyBoardSchema.safeParse({}).success).toBe(false)
    expect(addCompanyBoardSchema.safeParse({ company: '   ' }).success).toBe(false)
  })

  it('accepts an explicit provider + token for an agent that already knows the slug', () => {
    expect(addCompanyBoardSchema.safeParse({ company: 'Acme', provider: 'ashby', token: 'acme' }).success).toBe(true)
  })

  it('rejects a provider that is not one of the four board APIs', () => {
    expect(addCompanyBoardSchema.safeParse({ company: 'Acme', provider: 'smartrecruiters' }).success).toBe(false)
    expect(addCompanyBoardSchema.safeParse({ company: 'Acme', provider: 'linkedin' }).success).toBe(false)
  })

  it('rejects an over-long company, token, or display name', () => {
    expect(addCompanyBoardSchema.safeParse({ company: 'a'.repeat(201) }).success).toBe(false)
    expect(addCompanyBoardSchema.safeParse({ company: 'Acme', token: 'a'.repeat(101) }).success).toBe(false)
    expect(addCompanyBoardSchema.safeParse({ company: 'Acme', displayName: 'a'.repeat(201) }).success).toBe(false)
  })
})

describe('listCompanyBoardsShape', () => {
  it('accepts an empty query (every field optional)', () => {
    expect(listCompanyBoardsSchema.safeParse({}).success).toBe(true)
  })

  it('rejects a limit outside [1, 50] and a negative offset', () => {
    expect(listCompanyBoardsSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(listCompanyBoardsSchema.safeParse({ limit: 51 }).success).toBe(false)
    expect(listCompanyBoardsSchema.safeParse({ offset: -1 }).success).toBe(false)
  })
})
