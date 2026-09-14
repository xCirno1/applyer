/*
 * Resume content is written by the agent (or pasted by the user) and ends up
 * inside an HTML document that Chromium renders, both for the PDF and in the
 * preview frame. Every string that reaches a template goes through here.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char)
}

/**
 * Only http(s) and mailto links are ever emitted as `href`. Anything else
 * (`javascript:`, `file:`, a bare word) renders as plain text: the preview is
 * sandboxed, but the exported PDF is opened in whatever viewer the recruiter
 * has, and a clickable `javascript:` link there is not a risk worth taking
 * for a field the agent fills in.
 */
export function safeHref(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^mailto:[^\s]+@[^\s]+$/i.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
  } catch {
    // Not an absolute URL; fall through.
  }
  return null
}

/** Strips the scheme and trailing slash for display ("linkedin.com/in/jane"), so links read like a resume, not a browser bar. */
export function displayUrl(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^mailto:/i, '')
    .replace(/\/$/, '')
}
