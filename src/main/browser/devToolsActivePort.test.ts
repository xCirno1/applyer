import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  defaultChromiumProfileDirs,
  findDevToolsActivePorts,
  parseDevToolsActivePort,
  resolveRemoteBrowserCandidates
} from './devToolsActivePort'

const CHROME_FILE = '9222\n/devtools/browser/d2a53d02-f0fb-479f-b260-7e5ec40bf23f\n'

function fakeReader(files: Record<string, string>): (path: string) => Promise<string> {
  return async (path) => {
    const content = files[path]
    if (content === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
    return content
  }
}

describe('parseDevToolsActivePort', () => {
  it('reads the port and browser path Chrome writes', () => {
    expect(parseDevToolsActivePort(CHROME_FILE)).toEqual({
      port: 9222,
      path: '/devtools/browser/d2a53d02-f0fb-479f-b260-7e5ec40bf23f'
    })
  })

  it('tolerates CRLF line endings and surrounding whitespace', () => {
    expect(parseDevToolsActivePort(' 9222 \r\n /devtools/browser/abc \r\n')).toEqual({
      port: 9222,
      path: '/devtools/browser/abc'
    })
  })

  it('rejects an empty, truncated or otherwise malformed file', () => {
    expect(parseDevToolsActivePort('')).toBeNull()
    expect(parseDevToolsActivePort('9222\n')).toBeNull()
    expect(parseDevToolsActivePort('nine\n/devtools/browser/abc')).toBeNull()
    expect(parseDevToolsActivePort('0\n/devtools/browser/abc')).toBeNull()
    expect(parseDevToolsActivePort('70000\n/devtools/browser/abc')).toBeNull()
    expect(parseDevToolsActivePort('9222\n/somewhere/else')).toBeNull()
    expect(parseDevToolsActivePort('9222\n/devtools/browser/../../etc')).toBeNull()
    expect(parseDevToolsActivePort('9222\n/devtools/browser/abc\nextra')).toBeNull()
  })
})

describe('defaultChromiumProfileDirs', () => {
  it('uses XDG_CONFIG_HOME on Linux when set, plus the snap and flatpak roots under home', () => {
    const dirs = defaultChromiumProfileDirs('linux', { XDG_CONFIG_HOME: '/xdg' }, '/home/u')
    expect(dirs).toContain('/xdg/google-chrome')
    expect(dirs).toContain('/xdg/chromium')
    expect(dirs).toContain('/xdg/BraveSoftware/Brave-Browser')
    expect(dirs).toContain('/home/u/snap/chromium/common/chromium')
    expect(dirs).toContain('/home/u/.var/app/com.google.Chrome/config/google-chrome')
  })

  it('falls back to ~/.config on Linux without XDG_CONFIG_HOME', () => {
    expect(defaultChromiumProfileDirs('linux', {}, '/home/u')).toContain('/home/u/.config/google-chrome')
  })

  it('uses Application Support on macOS', () => {
    const dirs = defaultChromiumProfileDirs('darwin', {}, '/Users/u')
    expect(dirs).toContain('/Users/u/Library/Application Support/Google/Chrome')
    expect(dirs).toContain('/Users/u/Library/Application Support/Microsoft Edge')
  })

  it('uses LOCALAPPDATA on Windows, falling back to AppData/Local', () => {
    expect(defaultChromiumProfileDirs('win32', { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'C:\\Users\\u')).toContain(
      join('C:\\Users\\u\\AppData\\Local', 'Google', 'Chrome', 'User Data')
    )
    expect(defaultChromiumProfileDirs('win32', {}, 'C:\\Users\\u')).toContain(
      join('C:\\Users\\u', 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data')
    )
  })
})

describe('findDevToolsActivePorts', () => {
  it('returns one entry per folder with a readable, well-formed file', async () => {
    const read = fakeReader({
      [join('/p/chrome', 'DevToolsActivePort')]: CHROME_FILE,
      [join('/p/edge', 'DevToolsActivePort')]: '9333\n/devtools/browser/edge-id\n',
      [join('/p/broken', 'DevToolsActivePort')]: 'garbage'
    })
    await expect(findDevToolsActivePorts(['/p/chrome', '/p/missing', '/p/edge', '/p/broken'], read)).resolves.toEqual([
      { profileDir: '/p/chrome', port: 9222, path: '/devtools/browser/d2a53d02-f0fb-479f-b260-7e5ec40bf23f' },
      { profileDir: '/p/edge', port: 9333, path: '/devtools/browser/edge-id' }
    ])
  })

  it('treats a read error other than ENOENT (permissions) as no file', async () => {
    const read = async (): Promise<string> => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    }
    await expect(findDevToolsActivePorts(['/p/chrome'], read)).resolves.toEqual([])
  })
})

describe('resolveRemoteBrowserCandidates', () => {
  const read = fakeReader({
    [join('/p/chrome', 'DevToolsActivePort')]: CHROME_FILE,
    [join('/p/edge', 'DevToolsActivePort')]: '9333\n/devtools/browser/edge-id\n'
  })
  const profileDirs = ['/p/chrome', '/p/edge']

  it('passes a websocket address through untouched', async () => {
    const ws = 'ws://127.0.0.1:9222/devtools/browser/typed-in'
    await expect(resolveRemoteBrowserCandidates(ws, { profileDirs, read })).resolves.toEqual([{ url: ws }])
  })

  it('puts the discovered websocket path first and the HTTP root last for a loopback address', async () => {
    await expect(resolveRemoteBrowserCandidates('http://127.0.0.1:9222', { profileDirs, read })).resolves.toEqual([
      { url: 'ws://127.0.0.1:9222/devtools/browser/d2a53d02-f0fb-479f-b260-7e5ec40bf23f', profileDir: '/p/chrome' },
      { url: 'http://127.0.0.1:9222' }
    ])
  })

  it('only matches files naming the same port', async () => {
    await expect(resolveRemoteBrowserCandidates('http://localhost:9333/', { profileDirs, read })).resolves.toEqual([
      { url: 'ws://localhost:9333/devtools/browser/edge-id', profileDir: '/p/edge' },
      { url: 'http://localhost:9333/' }
    ])
    await expect(resolveRemoteBrowserCandidates('http://127.0.0.1:9999', { profileDirs, read })).resolves.toEqual([
      { url: 'http://127.0.0.1:9999' }
    ])
  })

  it('does not consult local profile folders for a non-loopback address', async () => {
    await expect(
      resolveRemoteBrowserCandidates('http://192.168.1.20:9222', { profileDirs, read })
    ).resolves.toEqual([{ url: 'http://192.168.1.20:9222' }])
  })

  it('dedupes two profile folders that point at the same browser', async () => {
    const dup = fakeReader({
      [join('/p/a', 'DevToolsActivePort')]: CHROME_FILE,
      [join('/p/b', 'DevToolsActivePort')]: CHROME_FILE
    })
    const candidates = await resolveRemoteBrowserCandidates('http://127.0.0.1:9222', { profileDirs: ['/p/a', '/p/b'], read: dup })
    expect(candidates).toHaveLength(2)
    expect(candidates[0]).toEqual({
      url: 'ws://127.0.0.1:9222/devtools/browser/d2a53d02-f0fb-479f-b260-7e5ec40bf23f',
      profileDir: '/p/a'
    })
  })

  it('assumes the scheme default port when none is given', async () => {
    const read80 = fakeReader({ [join('/p/x', 'DevToolsActivePort')]: '80\n/devtools/browser/x\n' })
    await expect(resolveRemoteBrowserCandidates('http://localhost', { profileDirs: ['/p/x'], read: read80 })).resolves.toEqual([
      { url: 'ws://localhost:80/devtools/browser/x', profileDir: '/p/x' },
      { url: 'http://localhost' }
    ])
  })
})
