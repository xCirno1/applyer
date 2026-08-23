import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  build: { electronLanguages?: string[]; files: string[] }
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
})
