import { describe, it, expect } from 'vitest'
import {
  formatChecksumFile,
  hostTargetPlatform,
  isDistributable,
  parseArgs,
  planPackaging,
  resolveRequestedPlatforms,
  UsageError,
  type HostCapabilities,
  type PackagingPlan,
  type PipelineConfig,
  type TargetPlatform
} from './packagePipeline'

const caps = (overrides: Partial<HostCapabilities> = {}): HostCapabilities => ({
  platform: 'linux',
  wine: false,
  docker: false,
  rpmbuild: true,
  ...overrides
})

const config = (overrides: Partial<PipelineConfig> = {}): PipelineConfig => ({
  linuxTargets: ['AppImage', 'deb', 'rpm'],
  preferDocker: false,
  unpackedOnly: false,
  ...overrides
})

const plan = (
  requested: TargetPlatform[],
  host: Partial<HostCapabilities> = {},
  cfg: Partial<PipelineConfig> = {}
): PackagingPlan => planPackaging(requested, caps(host), config(cfg))

describe('parseArgs', () => {
  it('defaults to the host platform when no platform flag is given', () => {
    expect(parseArgs([]).platforms).toBe('host')
  })

  it('collects platform flags and accepts the long aliases', () => {
    expect(parseArgs(['--linux', '--macos', '--windows']).platforms).toEqual(['linux', 'mac', 'win'])
  })

  it('rejects an unknown flag rather than silently building the host platform', () => {
    expect(() => parseArgs(['--linx'])).toThrow(UsageError)
  })

  it('rejects --all combined with a specific platform, which would be contradictory', () => {
    expect(() => parseArgs(['--all', '--linux'])).toThrow(UsageError)
  })

  it('carries the option flags through', () => {
    expect(parseArgs(['--docker'])).toMatchObject({ docker: true })
    expect(parseArgs(['-h'])).toMatchObject({ help: true })
    expect(parseArgs(['--dry-run'])).toMatchObject({ dryRun: true })
    expect(parseArgs(['--dir'])).toMatchObject({ unpackedOnly: true })
  })

  it('leaves every option off by default, so a bare run is a real build', () => {
    expect(parseArgs([])).toMatchObject({ docker: false, dryRun: false, unpackedOnly: false })
  })
})

describe('resolveRequestedPlatforms', () => {
  it('maps the host platform to its own target', () => {
    expect(hostTargetPlatform('darwin')).toBe('mac')
    expect(hostTargetPlatform('win32')).toBe('win')
    expect(hostTargetPlatform('linux')).toBe('linux')
  })

  it('expands --all to every platform', () => {
    expect(resolveRequestedPlatforms('all', 'linux')).toEqual(['linux', 'mac', 'win'])
  })

  it('de-duplicates and canonically orders explicit flags, so plan output is stable', () => {
    expect(resolveRequestedPlatforms(['win', 'linux', 'win'], 'linux')).toEqual(['linux', 'win'])
  })
})

describe('planPackaging', () => {
  it('builds the host platform natively', () => {
    expect(plan(['linux']).steps).toEqual([
      { kind: 'native', platforms: ['linux'], builderArgs: ['--linux'], notes: [] }
    ])
  })

  it('drops rpm, not the whole Linux build, when rpmbuild is missing', () => {
    const [step] = plan(['linux'], { rpmbuild: false }).steps
    expect(step?.builderArgs).toEqual(['--linux', 'AppImage', 'deb'])
    expect(step?.notes[0]).toContain('rpmbuild')
  })

  it('leaves the Linux targets to electron-builder when rpm is not configured at all', () => {
    const [step] = plan(['linux'], { rpmbuild: false }, { linuxTargets: ['AppImage', 'deb'] }).steps
    expect(step?.builderArgs).toEqual(['--linux'])
    expect(step?.notes).toEqual([])
  })

  it('refuses macOS off a Mac, and says why per host', () => {
    expect(plan(['mac'], { platform: 'linux' }).skipped[0]?.reason).toContain('hdiutil')
    expect(plan(['mac'], { platform: 'win32' }).skipped[0]?.reason).toContain('refuses')
    expect(plan(['mac'], { platform: 'darwin' }).steps[0]?.builderArgs).toEqual(['--mac'])
  })

  it('builds Windows natively off Windows when Wine is present, and notes it', () => {
    const [step] = plan(['win'], { wine: true }).steps
    expect(step).toMatchObject({ kind: 'native', builderArgs: ['--win'] })
    expect(step?.notes[0]).toContain('Wine')
  })

  it('falls back to Docker for Windows when there is no Wine', () => {
    const [step] = plan(['win'], { docker: true }).steps
    expect(step).toMatchObject({ kind: 'docker', platforms: ['win'], builderArgs: ['--win'] })
  })

  it('skips Windows with an actionable reason when neither Wine nor Docker is available', () => {
    expect(plan(['win']).steps).toEqual([])
    expect(plan(['win']).skipped[0]?.reason).toContain('Wine')
  })

  it('merges Linux and Windows into one container run rather than two', () => {
    const steps = plan(['linux', 'win'], { platform: 'darwin', docker: true }).steps
    expect(steps).toHaveLength(1)
    expect(steps[0]).toMatchObject({
      kind: 'docker',
      platforms: ['linux', 'win'],
      builderArgs: ['--linux', '--win']
    })
  })

  it('ignores host rpmbuild for a container build — the image brings its own toolchain', () => {
    const [step] = plan(['linux'], { platform: 'darwin', docker: true, rpmbuild: false }).steps
    expect(step?.builderArgs).toEqual(['--linux'])
  })

  it('honours --docker even where a native build would work', () => {
    const steps = plan(['linux'], { docker: true }, { preferDocker: true }).steps
    expect(steps[0]).toMatchObject({ kind: 'docker' })
  })

  it('reports the missing docker binary when --docker was explicitly asked for', () => {
    expect(plan(['linux'], {}, { preferDocker: true }).skipped[0]?.reason).toContain('docker')
  })

  it('never routes macOS through Docker, since no image can produce a .dmg', () => {
    const { steps, skipped } = plan(['mac'], { platform: 'linux', docker: true }, { preferDocker: true })
    expect(steps).toEqual([])
    expect(skipped.map((s) => s.platform)).toEqual(['mac'])
  })

  it('builds what it can and reports the rest, for --all on a Linux host', () => {
    const { steps, skipped } = plan(['linux', 'mac', 'win'], { wine: true })
    expect(steps.map((s) => s.platforms)).toEqual([['linux'], ['win']])
    expect(skipped.map((s) => s.platform)).toEqual(['mac'])
  })

  it('appends --dir to every step under --dir, without changing which steps exist', () => {
    const { steps } = plan(['linux', 'win'], { wine: true }, { unpackedOnly: true })
    expect(steps.map((s) => s.builderArgs)).toEqual([
      ['--linux', '--dir'],
      ['--win', '--dir']
    ])
  })

  it('does not subset the Linux targets under --dir, since --dir never reaches rpm', () => {
    const [step] = plan(['linux'], { rpmbuild: false }, { unpackedOnly: true }).steps
    expect(step?.builderArgs).toEqual(['--linux', '--dir'])
    expect(step?.notes).toEqual([])
  })

  it('orders native steps before the container step, so the fast path runs first', () => {
    const { steps } = plan(['linux', 'win'], { docker: true })
    expect(steps.map((s) => s.kind)).toEqual(['native', 'docker'])
  })
})

describe('isDistributable', () => {
  it('keeps the files a download page serves', () => {
    for (const name of [
      'Applyer-0.1.0-linux-x86_64.AppImage',
      'applyer_0.1.0_amd64.deb',
      'applyer-0.1.0.x86_64.rpm',
      'Applyer-0.1.0-mac-arm64.dmg',
      'Applyer-0.1.0-mac-arm64.zip',
      'Applyer-0.1.0-win-x64-setup.exe'
    ]) {
      expect(isDistributable(name), name).toBe(true)
    }
  })

  it('drops update metadata, blockmaps, and build leftovers nobody downloads', () => {
    for (const name of [
      'latest-linux.yml',
      'latest-mac.yml',
      'builder-debug.yml',
      'Applyer-0.1.0-mac-arm64.zip.blockmap',
      'linux-unpacked'
    ]) {
      expect(isDistributable(name), name).toBe(false)
    }
  })
})

describe('formatChecksumFile', () => {
  it('emits coreutils format (two spaces) so `sha256sum -c` reads it back', () => {
    expect(formatChecksumFile([{ name: 'b.deb', sha256: 'bb' }])).toBe('bb  b.deb\n')
  })

  it('sorts by name, so a re-run produces an identical file for an identical set', () => {
    const out = formatChecksumFile([
      { name: 'c.exe', sha256: 'cc' },
      { name: 'a.dmg', sha256: 'aa' },
      { name: 'b.deb', sha256: 'bb' }
    ])
    expect(out.split('\n').filter(Boolean)).toEqual(['aa  a.dmg', 'bb  b.deb', 'cc  c.exe'])
  })
})
