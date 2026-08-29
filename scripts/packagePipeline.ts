/**
 * Packaging pipeline rules: which distributables a given host can actually
 * produce, and what to hand electron-builder for each one.
 *
 * Plain module — no spawning, no fs, no process globals — so the capability
 * matrix and the argument building are testable without running a real build
 * (same split as src/renderer's workspaceLayout.ts vs useWorkspaceLayout.ts).
 * scripts/package.ts is the half that probes the host and runs the commands.
 */

export type TargetPlatform = 'linux' | 'mac' | 'win'

/** Canonical ordering, used everywhere a plan is emitted so runs are deterministic. */
export const TARGET_PLATFORMS: readonly TargetPlatform[] = ['linux', 'mac', 'win']

export const PLATFORM_LABELS: Record<TargetPlatform, string> = {
  linux: 'Linux',
  mac: 'macOS',
  win: 'Windows'
}

export interface HostCapabilities {
  /** process.platform of the machine running the build. */
  platform: NodeJS.Platform
  /** `wine` on PATH — electron-builder runs the NSIS installer under it off Windows. */
  wine: boolean
  /** `docker` on PATH — lets a non-Linux host build the Linux/Windows targets. */
  docker: boolean
  /** `rpmbuild` on PATH — fpm shells out to it, and only for the rpm target. */
  rpmbuild: boolean
}

export interface PipelineConfig {
  /** build.linux.target from package.json, so this module never restates it. */
  linuxTargets: string[]
  /** Force the container path even where a native build is possible. */
  preferDocker: boolean
  /** Pass electron-builder --dir: unpacked app only, no installers. */
  unpackedOnly: boolean
}

export interface PackagingStep {
  kind: 'native' | 'docker'
  /** Platforms this single command produces. Native steps always have exactly one. */
  platforms: TargetPlatform[]
  /** Arguments appended to `electron-builder`. */
  builderArgs: string[]
  /** Things the operator should know about this step, e.g. a dropped target. */
  notes: string[]
}

export interface SkippedPlatform {
  platform: TargetPlatform
  reason: string
}

export interface PackagingPlan {
  steps: PackagingStep[]
  skipped: SkippedPlatform[]
}

export class UsageError extends Error {}

export const USAGE = `Usage: tsx scripts/package.ts [platforms] [options]

Platforms
  --linux    AppImage + deb + rpm
  --mac      dmg + zip           (macOS host only)
  --win      NSIS setup + portable exe
  --all      every platform this host can build

Options
  --docker   build the Linux/Windows targets in electron-builder's container
             image instead of natively (brings Wine with it)
  --dry-run  print the plan and the exact commands, run none of them
  --dir      stop at the unpacked app (electron-builder --dir): no installers,
             no checksums, roughly a quarter of the time

With no platform flag, builds for the current OS. Artifacts and a SHA256SUMS.txt
land in release/.`

export interface ParsedArgs {
  platforms: TargetPlatform[] | 'all' | 'host'
  docker: boolean
  dryRun: boolean
  /** electron-builder --dir: unpacked app only, no distributables. */
  unpackedOnly: boolean
  help: boolean
}

/**
 * Parses the CLI flags. Unknown flags are an error rather than a silent no-op:
 * a typo'd platform flag would otherwise quietly build the host platform only,
 * which is the sort of thing you notice after uploading the wrong file.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const platforms: TargetPlatform[] = []
  let all = false
  let docker = false
  let dryRun = false
  let unpackedOnly = false
  let help = false

  for (const arg of argv) {
    switch (arg) {
      case '--linux':
        platforms.push('linux')
        break
      case '--mac':
      case '--macos':
        platforms.push('mac')
        break
      case '--win':
      case '--windows':
        platforms.push('win')
        break
      case '--all':
        all = true
        break
      case '--docker':
        docker = true
        break
      case '--dry-run':
        dryRun = true
        break
      case '--dir':
      case '--unpacked':
        unpackedOnly = true
        break
      case '--help':
      case '-h':
        help = true
        break
      default:
        throw new UsageError(`Unknown option: ${arg}`)
    }
  }

  if (all && platforms.length > 0) {
    throw new UsageError('--all cannot be combined with a specific platform flag')
  }

  return {
    platforms: all ? 'all' : platforms.length > 0 ? platforms : 'host',
    docker,
    dryRun,
    unpackedOnly,
    help
  }
}

/** The platform a host builds by default when no flag is given. */
export function hostTargetPlatform(platform: NodeJS.Platform): TargetPlatform {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'win'
  return 'linux'
}

/** Resolves parsed flags to a concrete, de-duplicated, canonically ordered list. */
export function resolveRequestedPlatforms(
  requested: TargetPlatform[] | 'all' | 'host',
  platform: NodeJS.Platform
): TargetPlatform[] {
  if (requested === 'all') return [...TARGET_PLATFORMS]
  if (requested === 'host') return [hostTargetPlatform(platform)]
  return TARGET_PLATFORMS.filter((p) => requested.includes(p))
}

/**
 * Uploading is this pipeline's job (and the workflow's), never electron-builder's.
 *
 * Left implicit, electron-builder guesses a publish policy: on CI without a tag
 * it picks "onTagOrDraft", and for the GitHub provider specifically that policy
 * does *not* short-circuit on a non-tag build — it goes looking for a draft
 * release to attach to, which needs a token, and fails the whole run with
 * `GH_TOKEN is not set` after every artifact has already been built. Passing the
 * policy explicitly is what electron-builder itself now recommends.
 */
export const PUBLISH_ARGS = ['--publish', 'never']

const MAC_ON_WINDOWS =
  'electron-builder refuses macOS builds on a Windows host. Build it on a Mac (or a macOS CI runner).'
const MAC_ELSEWHERE =
  'macOS builds need macOS: the .dmg is assembled with hdiutil and the .app has to be signed with codesign. Build it on a Mac (or a macOS CI runner).'
const LINUX_NEEDS_DOCKER =
  'the Linux targets need Linux tooling. Install Docker and re-run with --docker, or build on a Linux machine.'
const WIN_NEEDS_WINE =
  'the NSIS installer runs under Wine off Windows. Install Wine, re-run with --docker, or build on Windows.'
const DOCKER_MISSING = 'no `docker` on PATH, so the container path is unavailable.'

/**
 * Works out how to satisfy a platform request on this host, degrading with a
 * stated reason rather than failing late inside electron-builder.
 *
 * Linux and Windows can share one container invocation (the image is Linux with
 * Wine in it), so they are merged into a single docker step — one `npm ci` and
 * one native rebuild instead of two.
 */
export function planPackaging(
  requested: TargetPlatform[],
  caps: HostCapabilities,
  config: PipelineConfig
): PackagingPlan {
  const steps: PackagingStep[] = []
  const skipped: SkippedPlatform[] = []
  const viaDocker: TargetPlatform[] = []

  for (const platform of TARGET_PLATFORMS.filter((p) => requested.includes(p))) {
    if (platform === 'mac') {
      // Nothing containerises this one, so --docker is irrelevant here.
      if (caps.platform === 'darwin') {
        steps.push({ kind: 'native', platforms: ['mac'], builderArgs: ['--mac'], notes: [] })
      } else {
        skipped.push({
          platform,
          reason: caps.platform === 'win32' ? MAC_ON_WINDOWS : MAC_ELSEWHERE
        })
      }
      continue
    }

    const nativelyBuildable =
      platform === 'linux' ? caps.platform === 'linux' : caps.platform === 'win32' || caps.wine

    if (config.preferDocker || !nativelyBuildable) {
      if (caps.docker) {
        viaDocker.push(platform)
      } else if (config.preferDocker) {
        skipped.push({ platform, reason: DOCKER_MISSING })
      } else {
        skipped.push({
          platform,
          reason: platform === 'linux' ? LINUX_NEEDS_DOCKER : WIN_NEEDS_WINE
        })
      }
      continue
    }

    steps.push(
      platform === 'linux'
        ? nativeLinuxStep(caps, config)
        : {
            kind: 'native',
            platforms: ['win'],
            builderArgs: ['--win'],
            notes: caps.platform === 'win32' ? [] : ['NSIS runs under Wine on this host.']
          }
    )
  }

  if (viaDocker.length > 0) {
    steps.push({
      kind: 'docker',
      platforms: viaDocker,
      // The image is a Linux box with Wine, so its own rpmbuild/Wine decide the
      // targets — never this host's missing tooling.
      builderArgs: viaDocker.map((p) => `--${p}`),
      // No note: describePlan already marks the step as "(docker)", and the
      // notes channel is for things that change what comes out.
      notes: []
    })
  }

  return {
    steps: steps.map((step) => ({
      ...step,
      builderArgs: [
        ...step.builderArgs,
        // --dir stops before any target is produced, so it applies uniformly to
        // every step rather than changing which ones exist.
        ...(config.unpackedOnly ? ['--dir'] : []),
        ...PUBLISH_ARGS
      ]
    })),
    skipped
  }
}

/**
 * rpm is the one Linux target with an external dependency (fpm shells out to
 * rpmbuild), so a host without it builds the rest instead of failing outright.
 */
function nativeLinuxStep(caps: HostCapabilities, config: PipelineConfig): PackagingStep {
  const wanted = config.linuxTargets
  // --dir never reaches the rpm stage, so nothing needs subsetting there.
  if (caps.rpmbuild || config.unpackedOnly || !wanted.includes('rpm')) {
    return { kind: 'native', platforms: ['linux'], builderArgs: ['--linux'], notes: [] }
  }
  const kept = wanted.filter((target) => target !== 'rpm')
  return {
    kind: 'native',
    platforms: ['linux'],
    builderArgs: ['--linux', ...kept],
    notes: ['Skipping rpm: no `rpmbuild` on PATH (apt install rpm / dnf install rpm-build).']
  }
}

/** electron-builder writes more than distributables into release/; this is the subset to publish. */
const DISTRIBUTABLE_EXTENSIONS = [
  '.AppImage',
  '.deb',
  '.rpm',
  '.dmg',
  '.pkg',
  '.zip',
  '.exe',
  '.msi',
  '.snap',
  '.tar.gz'
]

/**
 * Filters release/ down to files a download page would serve — dropping the
 * update metadata (latest*.yml), the delta blockmaps, and the unpacked build
 * directories, none of which anyone downloads directly.
 */
export function isDistributable(fileName: string): boolean {
  if (fileName.endsWith('.blockmap')) return false
  return DISTRIBUTABLE_EXTENSIONS.some((ext) => fileName.endsWith(ext))
}

export interface ChecksumEntry {
  name: string
  sha256: string
}

/**
 * coreutils format (`<hash>  <name>`, two spaces), so `sha256sum -c
 * SHA256SUMS.txt` verifies a directory of downloads as-is.
 */
export function formatChecksumFile(entries: ChecksumEntry[]): string {
  return (
    [...entries]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `${entry.sha256}  ${entry.name}`)
      .join('\n') + '\n'
  )
}

/** One-line summary of a plan, for the console header. */
export function describePlan(plan: PackagingPlan): string {
  if (plan.steps.length === 0) return 'nothing to build'
  return plan.steps
    .map(
      (step) =>
        `${step.platforms.map((p) => PLATFORM_LABELS[p]).join(' + ')}${
          step.kind === 'docker' ? ' (docker)' : ''
        }`
    )
    .join(', ')
}
