import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  build: { electronLanguages?: string[]; files: string[]; asar?: boolean; asarUnpack?: string[] }
}

/** The translation catalogs the app actually ships, e.g. ['en', 'id']. */
const catalogs = readdirSync(resolve(__dirname, '../renderer/src/i18n/locales'))

describe('packaging config', () => {
  // `electronLanguages` prunes Electron's *own* locale resources, which is
  // what the native surfaces read: file dialogs, the context menu, the
  // application menu. Asserted against the catalog directory rather than a
  // hardcoded list so adding a third language cannot leave those surfaces
  // pinned to English without this failing.
  it('packages an Electron locale for every catalog the app ships', () => {
    const packaged = pkg.build.electronLanguages ?? []
    for (const catalog of catalogs) {
      expect(packaged.some((locale) => locale === catalog || locale.startsWith(`${catalog}-`))).toBe(true)
    }
  })

  // The other half of the rule: Electron carries a resource file per language,
  // and this app has no reason to ship the ~50 it does not translate.
  it('packages no locales beyond those', () => {
    expect(pkg.build.electronLanguages).toHaveLength(catalogs.length)
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
