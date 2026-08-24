import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  build: { electronLanguages?: string[]; files: string[]; asar?: boolean; asarUnpack?: string[] }
}

describe('packaging config', () => {
  it('restricts Electron locales to en-US', () => {
    expect(pkg.build.electronLanguages).toEqual(['en-US'])
  })

  it('excludes the whole .local-browsers directory — packaged builds resolve browsers at runtime instead (browserController.ts)', () => {
    expect(pkg.build.files).toContain('!**/node_modules/playwright-core/.local-browsers/**')
  })

  it('excludes the unused @napi-rs/canvas PDF-rendering dependency', () => {
    expect(pkg.build.files).toContain('!**/node_modules/@napi-rs/canvas*/**')
  })

  it('enables asar', () => {
    expect(pkg.build.asar).toBe(true)
  })

  it('unpacks native (.node) addons — better-sqlite3/node-pty must load via dlopen, which cannot read from inside an asar archive', () => {
    expect(pkg.build.asarUnpack).toContain('**/*.node')
  })
})
