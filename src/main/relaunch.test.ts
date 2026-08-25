import { describe, it, expect } from 'vitest'
import { appImageLauncherArgsFor, relaunchOptionsFor } from './relaunch'

const APP_IMAGE = '/home/someone/Downloads/Applyer-0.1.0.AppImage'
// What process.argv looks like inside a running AppImage: argv[0] is the
// Electron binary in the temporary squashfs mount, which is gone by the time
// the replacement process would be spawned.
const MOUNTED_EXEC_PATH = '/tmp/.mount_Applye9Xk2p/applyer'
const MOUNTED_ARGV = [MOUNTED_EXEC_PATH, '--some-flag']

describe('relaunchOptionsFor', () => {
  it('relaunches an AppImage from $APPIMAGE, not the doomed mount path', () => {
    const options = relaunchOptionsFor({ APPIMAGE: APP_IMAGE }, MOUNTED_ARGV)
    expect(options).toEqual({ execPath: APP_IMAGE, args: ['--some-flag'] })
  })

  it('carries no args over when the run had none', () => {
    const options = relaunchOptionsFor({ APPIMAGE: APP_IMAGE }, [MOUNTED_EXEC_PATH])
    expect(options).toEqual({ execPath: APP_IMAGE, args: [] })
  })

  it('falls back to the Electron default when not running as an AppImage', () => {
    expect(relaunchOptionsFor({}, ['/opt/Applyer/applyer'])).toBeNull()
  })

  it.each([
    ['an empty value', ''],
    ['a whitespace-only value', '   ']
  ])('falls back to the Electron default for %s of $APPIMAGE', (_label, value) => {
    expect(relaunchOptionsFor({ APPIMAGE: value }, MOUNTED_ARGV)).toBeNull()
  })
})

describe('appImageLauncherArgsFor', () => {
  it('passes the parent pid, AppImage path, and original arguments as separate shell parameters', () => {
    const args = appImageLauncherArgsFor(1234, {
      execPath: '/home/someone/Applyer builds/Applyer.AppImage',
      args: ['--flag', 'value with spaces']
    })

    expect(args.slice(2)).toEqual([
      'applyer-appimage-relaunch',
      '1234',
      '/home/someone/Applyer builds/Applyer.AppImage',
      '--flag',
      'value with spaces'
    ])
    expect(args[0]).toBe('-c')
    expect(args[1]).toContain('while kill -0 "$parent_pid"')
    expect(args[1]).toContain('exec "$app_image" "$@"')
  })
})
