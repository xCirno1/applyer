/**
 * Packaging entry point for every platform: plans what this host can build,
 * runs electron-builder for each platform (natively, or in electron-builder's
 * Wine container), then writes a SHA256SUMS.txt next to the artifacts so a
 * self-hosted download page has something to verify against.
 *
 * The rules live in scripts/packagePipeline.ts; this file is the side effects.
 *
 * Usage: tsx scripts/package.ts [--linux] [--mac] [--win] [--all] [--docker]
 */
import { spawnSync } from 'child_process'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { pipeline } from 'stream/promises'
import {
  describePlan,
  formatChecksumFile,
  isDistributable,
  needsShell,
  parseArgs,
  planPackaging,
  resolveRequestedPlatforms,
  UsageError,
  USAGE,
  type ChecksumEntry,
  type HostCapabilities,
  type PackagingStep
} from './packagePipeline'

const projectRoot = resolve(import.meta.dirname, '..')
const releaseDir = join(projectRoot, 'release')
const DOCKER_IMAGE = 'electronuserland/builder:wine'

const bold = (text: string): string => `\x1b[1m${text}\x1b[0m`
const dim = (text: string): string => `\x1b[2m${text}\x1b[0m`
const red = (text: string): string => `\x1b[31m${text}\x1b[0m`
const yellow = (text: string): string => `\x1b[33m${text}\x1b[0m`
const green = (text: string): string => `\x1b[32m${text}\x1b[0m`

function hasCommand(name: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    return spawnSync(probe, [name], { stdio: 'ignore' }).status === 0
  } catch {
    // A missing probe binary is indistinguishable from a missing command here,
    // and both mean the same thing for planning: treat it as unavailable.
    return false
  }
}

/** Shell-quotes an argument for display only, so a printed command is copy-pasteable. */
function quoteArg(arg: string): string {
  return /[\s"'$&|;<>()]/.test(arg) ? `'${arg.replaceAll("'", `'\\''`)}'` : arg
}

function formatCommand(command: string, args: string[]): string {
  return `${command} ${args.map(quoteArg).join(' ')}`
}

function run(command: string, args: string[]): void {
  console.log(dim(`\n$ ${formatCommand(command, args)}\n`))
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: needsShell(command, process.platform)
  })
  if (result.error) {
    throw new Error(`Failed to start \`${command}\`: ${result.error.message}`)
  }
  if (result.signal) {
    throw new Error(`\`${command}\` was terminated by signal ${result.signal}`)
  }
  if (result.status !== 0) {
    throw new Error(`\`${command} ${args.join(' ')}\` exited with code ${result.status}`)
  }
}

/**
 * build.linux.target from package.json, so the rpm-dropping rule never has to
 * restate the configured target list. Anything unexpected in the file degrades
 * to "no known targets" rather than throwing: the only consequence is that the
 * plan cannot subset the Linux targets, and electron-builder still has the
 * real config.
 */
async function readLinuxTargets(): Promise<string[]> {
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    const targets =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as { build?: { linux?: { target?: unknown } } }).build?.linux?.target
        : undefined
    if (!Array.isArray(targets)) return []
    return targets
      .map((entry) =>
        typeof entry === 'string'
          ? entry
          : typeof entry === 'object' && entry !== null && typeof (entry as { target?: unknown }).target === 'string'
            ? (entry as { target: string }).target
            : null
      )
      .filter((entry): entry is string => entry !== null)
  } catch (err) {
    console.warn(yellow(`Could not read build.linux.target from package.json: ${String(err)}`))
    return []
  }
}

async function detectCapabilities(): Promise<HostCapabilities> {
  return {
    platform: process.platform,
    wine: hasCommand('wine'),
    docker: hasCommand('docker'),
    rpmbuild: hasCommand('rpmbuild')
  }
}

/**
 * The container runs as root (the image is built that way), so anything it
 * writes through the bind mount would land root-owned on a Linux host. Handing
 * it the caller's uid/gid to chown on the way out keeps release/ and out/
 * deletable afterwards without sudo.
 */
function dockerOwnershipFix(): string {
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (uid === undefined || gid === undefined) return ''
  return ` && chown -R ${uid}:${gid} /project/release /project/out`
}

const electronCache = join(homedir(), '.cache', 'electron')
const builderCache = join(homedir(), '.cache', 'electron-builder')

/** Built separately from running it, so --dry-run can print the real command. */
function dockerArgs(step: PackagingStep): string[] {
  const inner = [
    'npm ci --ignore-scripts',
    'npx electron-rebuild -f -w better-sqlite3,node-pty',
    'npm run build',
    `npx electron-builder ${step.builderArgs.join(' ')}`
  ].join(' && ')

  return [
    'run',
    '--rm',
    '-v',
    `${projectRoot}:/project`,
    // Anonymous volume: the container installs its own node_modules (native
    // modules compiled for its Linux/Electron pair) without overwriting the
    // host's, which would leave the host unable to run the app.
    '-v',
    '/project/node_modules',
    '-v',
    `${electronCache}:/root/.cache/electron`,
    '-v',
    `${builderCache}:/root/.cache/electron-builder`,
    DOCKER_IMAGE,
    '/bin/bash',
    '-c',
    `${inner}${dockerOwnershipFix()}`
  ]
}

async function runDockerStep(step: PackagingStep): Promise<void> {
  // Pre-created so the bind mounts do not appear as fresh root-owned
  // directories in the user's home.
  await mkdir(electronCache, { recursive: true })
  await mkdir(builderCache, { recursive: true })
  run('docker', dockerArgs(step))
}

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return hash.digest('hex')
}

/**
 * Hashes every distributable currently in release/ — including artifacts from
 * an earlier run for another OS, which is the point: the file is meant to
 * describe the whole download set, however it was assembled.
 */
async function writeChecksums(): Promise<ChecksumEntry[]> {
  let fileNames: string[]
  try {
    fileNames = await readdir(releaseDir)
  } catch (err) {
    throw new Error(`No release directory to checksum (${releaseDir}): ${String(err)}`)
  }

  const entries: ChecksumEntry[] = []
  for (const name of fileNames.filter(isDistributable)) {
    const filePath = join(releaseDir, name)
    const info = await stat(filePath)
    if (!info.isFile()) continue
    entries.push({ name, sha256: await sha256(filePath) })
  }

  if (entries.length === 0) return entries
  await writeFile(join(releaseDir, 'SHA256SUMS.txt'), formatChecksumFile(entries), 'utf-8')
  return entries
}

function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`
}

async function main(): Promise<void> {
  let parsed
  try {
    parsed = parseArgs(process.argv.slice(2))
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${red(err.message)}\n\n${USAGE}`)
      process.exit(1)
    }
    throw err
  }

  if (parsed.help) {
    console.log(USAGE)
    return
  }

  const caps = await detectCapabilities()
  const requested = resolveRequestedPlatforms(parsed.platforms, caps.platform)
  const plan = planPackaging(requested, caps, {
    linuxTargets: await readLinuxTargets(),
    preferDocker: parsed.docker,
    unpackedOnly: parsed.unpackedOnly
  })

  console.log(bold(`\nPackaging: ${describePlan(plan)}`))
  for (const step of plan.steps) {
    for (const note of step.notes) console.log(yellow(`  ! ${note}`))
  }
  for (const skip of plan.skipped) {
    console.log(yellow(`  ! Skipping ${skip.platform}: ${skip.reason}`))
  }

  if (plan.steps.length === 0) {
    console.error(red('\nNothing can be built on this host for the requested platforms.'))
    process.exit(1)
  }

  const needsHostBuild = plan.steps.some((step) => step.kind === 'native')

  if (parsed.dryRun) {
    console.log(bold('\nWould run:'))
    if (needsHostBuild) console.log(`  npm run build`)
    for (const step of plan.steps) {
      console.log(
        `  ${
          step.kind === 'docker'
            ? formatCommand('docker', dockerArgs(step))
            : formatCommand('npx', ['electron-builder', ...step.builderArgs])
        }`
      )
    }
    if (!parsed.unpackedOnly) console.log(`  # then hash release/ into SHA256SUMS.txt`)
    console.log(dim('\nDry run: nothing was built and release/ was not touched.'))
    return
  }

  // The container builds its own copy; only native steps need the host bundle.
  if (needsHostBuild) {
    run('npm', ['run', 'build'])
  }

  for (const step of plan.steps) {
    if (step.kind === 'docker') {
      await runDockerStep(step)
    } else {
      run('npx', ['electron-builder', ...step.builderArgs])
    }
  }

  // --dir stops at release/<platform>-unpacked: there is no distributable to
  // hash, and writing a SHA256SUMS.txt for a previous run's artifacts here
  // would describe files this run never produced.
  if (parsed.unpackedOnly) {
    console.log(bold(`\n${green('✓')} unpacked app written to release/ (no installers, --dir)`))
    return
  }

  const entries = await writeChecksums()
  console.log(bold(`\n${green('✓')} release/ (${entries.length} artifacts)`))
  for (const entry of entries) {
    const { size } = await stat(join(releaseDir, entry.name))
    console.log(`  ${entry.name}  ${dim(formatSize(size))}`)
  }
  if (entries.length > 0) {
    console.log(dim('\n  SHA256SUMS.txt written (verify with: sha256sum -c SHA256SUMS.txt)'))
  }

  if (plan.skipped.length > 0) {
    console.log(
      yellow(
        `\nNot built here: ${plan.skipped.map((s) => s.platform).join(', ')}. See the messages above, or let the Release workflow build them.`
      )
    )
  }
}

main().catch((err: unknown) => {
  console.error(red(`\nPackaging failed: ${err instanceof Error ? err.message : String(err)}`))
  process.exit(1)
})
