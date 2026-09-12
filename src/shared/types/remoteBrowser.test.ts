import { describe, it, expect } from 'vitest'
import {
  checkRemoteBrowserEndpoint,
  isRemoteBrowserSettings,
  DEFAULT_REMOTE_BROWSER_ENDPOINT,
  DEFAULT_REMOTE_BROWSER_SETTINGS,
  REMOTE_BROWSER_ENDPOINT_MAX_LENGTH
} from './remoteBrowser'

describe('checkRemoteBrowserEndpoint', () => {
  it('accepts the default loopback endpoint', () => {
    expect(checkRemoteBrowserEndpoint(DEFAULT_REMOTE_BROWSER_ENDPOINT)).toEqual({
      ok: true,
      endpoint: DEFAULT_REMOTE_BROWSER_ENDPOINT
    })
  })

  it('accepts http, https, ws and wss endpoints', () => {
    for (const endpoint of [
      'http://localhost:9222',
      'https://debug.example.com',
      'ws://127.0.0.1:9222/devtools/browser/387adf4c-243f-4051-a181-46798f4a46f4',
      'wss://[::1]:9222/devtools/browser/abc'
    ]) {
      expect(checkRemoteBrowserEndpoint(endpoint)).toEqual({ ok: true, endpoint })
    }
  })

  it('trims surrounding whitespace but otherwise keeps what was typed', () => {
    expect(checkRemoteBrowserEndpoint('  http://127.0.0.1:9222 \n')).toEqual({
      ok: true,
      endpoint: 'http://127.0.0.1:9222'
    })
  })

  it('rejects an empty or whitespace-only value', () => {
    expect(checkRemoteBrowserEndpoint('')).toEqual({ ok: false, problem: 'empty' })
    expect(checkRemoteBrowserEndpoint('   ')).toEqual({ ok: false, problem: 'empty' })
  })

  it('rejects non-strings and unparseable strings', () => {
    expect(checkRemoteBrowserEndpoint(undefined)).toEqual({ ok: false, problem: 'invalidUrl' })
    expect(checkRemoteBrowserEndpoint(9222)).toEqual({ ok: false, problem: 'invalidUrl' })
    expect(checkRemoteBrowserEndpoint('127.0.0.1:9222')).toEqual({ ok: false, problem: 'invalidUrl' })
    expect(checkRemoteBrowserEndpoint('not a url')).toEqual({ ok: false, problem: 'invalidUrl' })
  })

  it('rejects schemes Playwright cannot attach through', () => {
    for (const endpoint of ['file:///tmp/x', 'javascript:alert(1)', 'ftp://127.0.0.1:9222', 'data:text/html,hi']) {
      expect(checkRemoteBrowserEndpoint(endpoint)).toEqual({ ok: false, problem: 'unsupportedProtocol' })
    }
  })

  it('rejects an endpoint longer than the persisted-setting cap', () => {
    const endpoint = `http://localhost/${'a'.repeat(REMOTE_BROWSER_ENDPOINT_MAX_LENGTH)}`
    expect(checkRemoteBrowserEndpoint(endpoint)).toEqual({ ok: false, problem: 'tooLong' })
  })
})

describe('isRemoteBrowserSettings', () => {
  it('accepts the defaults and a valid enabled configuration', () => {
    expect(isRemoteBrowserSettings(DEFAULT_REMOTE_BROWSER_SETTINGS)).toBe(true)
    expect(isRemoteBrowserSettings({ enabled: true, endpoint: 'ws://localhost:9222/devtools/browser/x' })).toBe(true)
  })

  it('rejects missing or mistyped fields', () => {
    expect(isRemoteBrowserSettings(null)).toBe(false)
    expect(isRemoteBrowserSettings('http://127.0.0.1:9222')).toBe(false)
    expect(isRemoteBrowserSettings({ enabled: 'yes', endpoint: 'http://127.0.0.1:9222' })).toBe(false)
    expect(isRemoteBrowserSettings({ enabled: true })).toBe(false)
    expect(isRemoteBrowserSettings({ enabled: true, endpoint: '' })).toBe(false)
    expect(isRemoteBrowserSettings({ enabled: false, endpoint: 'file:///etc/passwd' })).toBe(false)
  })
})
