import { session } from 'electron'

/**
 * Applied via webRequest rather than an HTML <meta> tag: Chromium's 'self'
 * CSP source is unreliable for file:// origins (which is how the packaged
 * renderer loads), so the header is set here instead where origin matching
 * is unambiguous. Only enabled in production — Vite's dev server needs its
 * own permissive rules for HMR that would fight a strict policy here.
 */
export function applyProductionCsp(): void {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: applyer-file:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}
