import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'path'
import { app } from 'electron'
import { __resetElectronMock, __setPackaged } from '../../../test/mocks/electron'
import { applyDevUserDataDir, devUserDataDir } from './userDataDir'

const originalArgv = process.argv

beforeEach(() => {
  __resetElectronMock()
  process.argv = ['electron', '.']
})

afterEach(() => {
  process.argv = originalArgv
})

describe('devUserDataDir', () => {
  it('appends a -dev suffix to the directory name, keeping the parent', () => {
    expect(devUserDataDir(join('/home', 'someone', '.config', 'applyer'))).toBe(
      join('/home', 'someone', '.config', 'applyer-dev')
    )
  })

  it('is idempotent for an already-suffixed directory', () => {
    const dir = join('/home', 'someone', '.config', 'applyer-dev')
    expect(devUserDataDir(dir)).toBe(dir)
  })

  it('leaves a path with no basename untouched rather than producing a stray "-dev"', () => {
    expect(devUserDataDir('/')).toBe('/')
  })
})

describe('applyDevUserDataDir', () => {
  it('redirects an unpackaged run to the -dev sibling directory', () => {
    __setPackaged(false)
    const defaultDir = app.getPath('userData')

    applyDevUserDataDir()

    expect(app.getPath('userData')).toBe(devUserDataDir(defaultDir))
    expect(app.getPath('userData')).not.toBe(defaultDir)
  })

  it('leaves a packaged run on the OS default directory', () => {
    __setPackaged(true)
    const defaultDir = app.getPath('userData')

    applyDevUserDataDir()

    expect(app.getPath('userData')).toBe(defaultDir)
  })

  it('does not re-suffix when called twice', () => {
    __setPackaged(false)
    const defaultDir = app.getPath('userData')

    applyDevUserDataDir()
    applyDevUserDataDir()

    expect(app.getPath('userData')).toBe(devUserDataDir(defaultDir))
  })

  it.each(['--user-data-dir=/tmp/elsewhere', '--user-data-dir'])(
    'respects an explicit %s override',
    (arg) => {
      __setPackaged(false)
      process.argv = ['electron', '.', arg]
      const overridden = app.getPath('userData')

      applyDevUserDataDir()

      expect(app.getPath('userData')).toBe(overridden)
    }
  )

  it('keeps the default directory and logs when the path cannot be resolved', () => {
    __setPackaged(false)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const getPath = vi.spyOn(app, 'getPath').mockImplementation(() => {
      throw new Error('no such path')
    })
    const setPath = vi.spyOn(app, 'setPath')

    expect(() => applyDevUserDataDir()).not.toThrow()

    expect(setPath).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalled()
    getPath.mockRestore()
  })
})
