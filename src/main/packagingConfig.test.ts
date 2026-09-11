import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, relative, resolve } from 'path'
import { createRequire } from 'node:module'
import { APP_VERSION } from '../shared/version'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('app-builder-lib'))
const plist = builderRequire('plist') as {
  build(value: Record<string, unknown>): string
  parse(xml: string): Record<string, unknown>
}

type TargetList = (string | { target: string })[]

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8')) as {
  version: string
  scripts: Record<string, string>
  build: {
    electronLanguages?: string[]
    files: string[]
    asar?: boolean
    asarUnpack?: string[]
    artifactName?: string
    linux?: { target?: TargetList; maintainer?: string; executableName?: string }
    mac?: { target?: TargetList }
    win?: { target?: TargetList }
    deb?: { artifactName?: string }
    rpm?: { artifactName?: string }
    nsis?: { artifactName?: string; oneClick?: boolean; allowToChangeInstallationDirectory?: boolean }
    portable?: { artifactName?: string }
  }
}

const targetNames = (targets: TargetList | undefined): string[] =>
  (targets ?? []).map((t) => (typeof t === 'string' ? t : t.target))

/** The translation catalogs the app actually ships, e.g. ['en', 'id']. */
const catalogs = readdirSync(resolve(__dirname, '../renderer/src/i18n/locales'))

function listFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

describe('packaging config', () => {
  it('keeps the application and MCP protocol versions aligned', () => {
    expect(APP_VERSION).toBe(pkg.version)
  })

  it('has no module names that collide on case-insensitive Windows or macOS filesystems', () => {
    const sourceRoot = resolve(__dirname, '..')
    const modulePaths = listFiles(sourceRoot)
      .filter((path) => /\.[cm]?[jt]sx?$/.test(path))
      .map((path) => relative(sourceRoot, path).replace(/\.[cm]?[jt]sx?$/, ''))
    const seen = new Map<string, string>()
    const collisions: string[][] = []

    for (const modulePath of modulePaths) {
      const key = modulePath.toLowerCase()
      const existing = seen.get(key)
      if (existing && existing !== modulePath) collisions.push([existing, modulePath])
      else seen.set(key, modulePath)
    }

    expect(collisions).toEqual([])
  })

  it('round-trips macOS application metadata through the packaging plist parser', () => {
    const info = {
      CFBundleIdentifier: 'com.applyer.app',
      CFBundleDisplayName: 'Applyer & Résumé',
      LSUIElement: false,
      CFBundleDocumentTypes: [{ CFBundleTypeExtensions: ['docx', 'pdf'] }]
    }
    expect(plist.parse(plist.build(info))).toEqual(info)
  })

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

describe('per-OS distributables', () => {
  it('builds the Linux formats an end user can actually install: a portable AppImage plus native deb/rpm packages', () => {
    expect(targetNames(pkg.build.linux?.target)).toEqual(['AppImage', 'deb', 'rpm'])
  })

  it('builds a macOS disk image plus a zip of the bare .app', () => {
    expect(targetNames(pkg.build.mac?.target)).toEqual(['dmg', 'zip'])
  })

  it('builds a Windows installer plus a portable single-file exe', () => {
    expect(targetNames(pkg.build.win?.target)).toEqual(['nsis', 'portable'])
  })

  it('names every artifact after its OS and architecture, so builds from three machines can share one release page', () => {
    expect(pkg.build.artifactName).toContain('${os}')
    expect(pkg.build.artifactName).toContain('${arch}')
    expect(pkg.build.artifactName).toContain('${version}')
  })

  it('gives the two Windows .exe artifacts distinct names — both would otherwise expand to the same file and overwrite each other', () => {
    expect(pkg.build.nsis?.artifactName).toBeTruthy()
    expect(pkg.build.portable?.artifactName).toBeTruthy()
    expect(pkg.build.nsis?.artifactName).not.toEqual(pkg.build.portable?.artifactName)
  })

  it('keeps deb/rpm on their distro-conventional file names rather than the global pattern', () => {
    expect(pkg.build.deb?.artifactName).toBe('${name}_${version}_${arch}.${ext}')
    expect(pkg.build.rpm?.artifactName).toBe('${name}-${version}.${arch}.${ext}')
  })

  it('sets a Linux maintainer — fpm rejects a deb/rpm build otherwise, since the package author carries no email address', () => {
    expect(pkg.build.linux?.maintainer).toMatch(/^.+ <[^@\s]+@[^@\s]+>$/)
  })

  it('installs to a user-chosen directory instead of a one-click install, so an unelevated Windows install works', () => {
    expect(pkg.build.nsis?.oneClick).toBe(false)
    expect(pkg.build.nsis?.allowToChangeInstallationDirectory).toBe(true)
  })

  it('exposes a per-OS packaging script for each platform', () => {
    expect(pkg.scripts['package:linux']).toContain('--linux')
    expect(pkg.scripts['package:win']).toContain('--win')
    expect(pkg.scripts['package:mac']).toContain('--mac')
  })
})
