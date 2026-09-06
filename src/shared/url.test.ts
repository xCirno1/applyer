import { describe, it, expect } from 'vitest'
import { isNavigableUrl } from './url'

describe('isNavigableUrl', () => {
  it('accepts http and https', () => {
    expect(isNavigableUrl('http://example.com/jobs/1')).toBe(true)
    expect(isNavigableUrl('https://example.com/jobs/1')).toBe(true)
  })

  it('accepts the shapes real postings come in', () => {
    expect(isNavigableUrl('https://boards.greenhouse.io/acme/jobs/123')).toBe(true)
    expect(isNavigableUrl('https://acme.myworkdayjobs.com/en-US/careers/job/Remote/Engineer_R-1?q=x&y=2')).toBe(true)
    expect(isNavigableUrl('https://example.com:8443/careers')).toBe(true)
    expect(isNavigableUrl('https://user:pass@example.com/jobs')).toBe(true)
  })

  // The whole reason this function exists: every one of these parses fine as
  // a URL, and `page.goto`/`shell.openExternal` would act on all of them.
  it('rejects file:, which is an arbitrary local file read through page.goto', () => {
    expect(isNavigableUrl('file:///etc/passwd')).toBe(false)
    expect(isNavigableUrl('file://localhost/etc/passwd')).toBe(false)
    expect(isNavigableUrl('FILE:///etc/passwd')).toBe(false)
  })

  it('rejects the other schemes that parse but must never be opened', () => {
    expect(isNavigableUrl('javascript:alert(1)')).toBe(false)
    expect(isNavigableUrl('data:text/html,<h1>hi</h1>')).toBe(false)
    expect(isNavigableUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isNavigableUrl('smb://server/share')).toBe(false)
    expect(isNavigableUrl('ftp://example.com/file')).toBe(false)
    expect(isNavigableUrl('chrome://settings')).toBe(false)
    expect(isNavigableUrl('applyer-file://screenshots/a.png')).toBe(false)
  })

  it('rejects anything that is not an absolute URL at all', () => {
    expect(isNavigableUrl('')).toBe(false)
    expect(isNavigableUrl('   ')).toBe(false)
    expect(isNavigableUrl('example.com/jobs')).toBe(false)
    expect(isNavigableUrl('/jobs/1')).toBe(false)
    expect(isNavigableUrl('not a url')).toBe(false)
  })

  it('rejects non-strings rather than coercing them', () => {
    expect(isNavigableUrl(undefined)).toBe(false)
    expect(isNavigableUrl(null)).toBe(false)
    expect(isNavigableUrl(42)).toBe(false)
    expect(isNavigableUrl({ toString: () => 'https://example.com' })).toBe(false)
    expect(isNavigableUrl(['https://example.com'])).toBe(false)
  })

  it('tolerates surrounding whitespace, which is not what makes a URL unsafe', () => {
    expect(isNavigableUrl('  https://example.com/jobs/1\n')).toBe(true)
    expect(isNavigableUrl('\tfile:///etc/passwd ')).toBe(false)
  })

  // A scheme is only the prefix — `https` appearing later in the string is
  // not one, and a nested scheme is judged by the outer one that gets acted on.
  it('judges the scheme that would actually be used', () => {
    expect(isNavigableUrl('javascript:window.open("https://example.com")')).toBe(false)
    expect(isNavigableUrl('data:text/html,https://example.com')).toBe(false)
  })
})
