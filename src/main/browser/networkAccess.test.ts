import { describe, expect, it, vi } from 'vitest'
import type { BrowserContext, Route } from 'playwright'
import {
  assertRemoteNetworkUrl,
  isLocalOrPrivateAddress,
  LOCAL_ADDRESS_BLOCKED_MESSAGE,
  protectBrowserContext
} from './networkAccess'

describe('isLocalOrPrivateAddress', () => {
  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.1',
    '::',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:127.0.0.1'
  ])('blocks %s', (address) => expect(isLocalOrPrivateAddress(address)).toBe(true))

  it.each(['1.1.1.1', '8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows public address %s',
    (address) => expect(isLocalOrPrivateAddress(address)).toBe(false)
  )
})

describe('assertRemoteNetworkUrl', () => {
  it('blocks localhost names without asking DNS', async () => {
    const lookup = vi.fn()
    await expect(assertRemoteNetworkUrl('http://api.localhost/test', lookup)).rejects.toThrow(
      LOCAL_ADDRESS_BLOCKED_MESSAGE
    )
    expect(lookup).not.toHaveBeenCalled()
  })

  it('blocks a hostname when any DNS answer is private', async () => {
    const lookup = vi.fn().mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 }
    ])
    await expect(assertRemoteNetworkUrl('https://jobs.example.test', lookup)).rejects.toThrow(
      LOCAL_ADDRESS_BLOCKED_MESSAGE
    )
  })

  it('allows a hostname when all DNS answers are public', async () => {
    const lookup = vi.fn().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
    await expect(assertRemoteNetworkUrl('https://example.com/jobs', lookup)).resolves.toBeUndefined()
  })

  it('fails closed when DNS resolution fails', async () => {
    const lookup = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(assertRemoteNetworkUrl('https://example.com/jobs', lookup)).rejects.toThrow(
      'could not be safely resolved'
    )
  })
})

describe('protectBrowserContext', () => {
  function fakeContext(): { context: BrowserContext; getHandler: () => (route: Route) => Promise<void> } {
    let handler: ((route: Route) => Promise<void>) | undefined
    const context = {
      route: vi.fn(async (_pattern: string, next: (route: Route) => Promise<void>) => {
        handler = next
      })
    } as unknown as BrowserContext
    return {
      context,
      getHandler: () => {
        if (!handler) throw new Error('route handler was not installed')
        return handler
      }
    }
  }

  function fakeRoute(url: string): { route: Route; continueMock: ReturnType<typeof vi.fn>; abortMock: ReturnType<typeof vi.fn> } {
    const continueMock = vi.fn()
    const abortMock = vi.fn()
    return {
      route: {
        request: () => ({ url: () => url }),
        continue: continueMock,
        abort: abortMock
      } as unknown as Route,
      continueMock,
      abortMock
    }
  }

  it('does not install interception when local access is explicitly allowed', async () => {
    const { context } = fakeContext()
    await protectBrowserContext(context, true)
    expect(context.route).not.toHaveBeenCalled()
  })

  it('aborts local requests, including subresources and redirects handled by the route', async () => {
    const { context, getHandler } = fakeContext()
    await protectBrowserContext(context, false)
    const { route, continueMock, abortMock } = fakeRoute('http://127.0.0.1/private')
    await getHandler()(route)
    expect(abortMock).toHaveBeenCalledWith('blockedbyclient')
    expect(continueMock).not.toHaveBeenCalled()
  })

  it('continues public requests', async () => {
    const { context, getHandler } = fakeContext()
    await protectBrowserContext(context, false)
    const { route, continueMock, abortMock } = fakeRoute('https://93.184.216.34/apply')
    await getHandler()(route)
    expect(continueMock).toHaveBeenCalledOnce()
    expect(abortMock).not.toHaveBeenCalled()
  })
})
