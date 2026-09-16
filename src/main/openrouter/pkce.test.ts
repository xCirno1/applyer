import { describe, it, expect } from 'vitest'
import { createHash } from 'crypto'
import { createPkcePair, sha256Hex } from './pkce'

function base64UrlFromBuffer(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('createPkcePair', () => {
  it('produces a verifier using only the base64url alphabet, unpadded', () => {
    const { verifier } = createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier).not.toContain('=')
  })

  it('produces a verifier long enough for a 64-byte value (no padding)', () => {
    const { verifier } = createPkcePair()
    // 64 random bytes base64-encode to 88 chars with padding, 86 without.
    expect(verifier.length).toBe(86)
  })

  it('derives the challenge as base64url(sha256(verifier))', () => {
    const { verifier, challenge } = createPkcePair()
    const expected = base64UrlFromBuffer(createHash('sha256').update(verifier).digest())
    expect(challenge).toBe(expected)
  })

  it('produces the challenge using only the base64url alphabet, unpadded', () => {
    const { challenge } = createPkcePair()
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).not.toContain('=')
  })

  it('generates a different pair every call', () => {
    const first = createPkcePair()
    const second = createPkcePair()
    expect(first.verifier).not.toBe(second.verifier)
    expect(first.challenge).not.toBe(second.challenge)
  })
})

describe('sha256Hex', () => {
  it('matches a known sha256 test vector for the empty string', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('matches a known sha256 test vector for "abc"', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('is deterministic for the same input', () => {
    expect(sha256Hex('some-api-key')).toBe(sha256Hex('some-api-key'))
  })

  it('differs for different inputs', () => {
    expect(sha256Hex('key-a')).not.toBe(sha256Hex('key-b'))
  })
})
