import { createHash, randomBytes } from 'crypto'

/**
 * PKCE (Proof Key for Code Exchange) for OpenRouter's OAuth flow.
 *
 * OpenRouter's "connect with OpenRouter" flow is a public client (Applyer
 * has no client secret to keep, and never will: it's a downloaded desktop
 * app, so any secret baked into it is not a secret). PKCE is what makes that
 * safe: the verifier never leaves this process until the callback with the
 * authorization code actually lands, and only the challenge (its hash) is
 * sent up front in the browser URL. Even if the code is intercepted in
 * transit, exchanging it for a key still requires the verifier that never
 * left main.
 *
 * `sha256Hex` is unrelated to the PKCE exchange itself; it is reused for
 * the `openrouter.ai/keys/<hash>` and `.../logs?api_key_hash=<hash>` deep
 * links, which hash the *key*, not the verifier, and want lowercase hex
 * rather than base64url.
 */

const VERIFIER_BYTES = 64

function base64UrlFromBuffer(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface PkcePair {
  verifier: string
  challenge: string
}

/** RFC 7636 `code_verifier`/`code_challenge` pair, challenge method S256. */
export function createPkcePair(): PkcePair {
  const verifier = base64UrlFromBuffer(randomBytes(VERIFIER_BYTES))
  const challenge = base64UrlFromBuffer(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

/** Lowercase hex sha256, for OpenRouter's key-hash deep links. */
export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}
