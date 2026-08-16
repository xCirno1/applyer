import sanitizeHtmlLib from 'sanitize-html'

/** Safe to persist and render (e.g. dangerouslySetInnerHTML in the detail modal). */
export function sanitizeDescriptionHtml(dirty: string): string {
  return sanitizeHtmlLib(dirty, {
    allowedTags: [
      'p', 'br', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 'a', 'h1', 'h2', 'h3', 'h4', 'span', 'div'
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtmlLib.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
    }
  })
}

/** Plain-text extraction for feeding to an LLM agent — no markup, no token waste. */
export function htmlToPlainText(html: string): string {
  const text = sanitizeHtmlLib(html, { allowedTags: [], allowedAttributes: {} })
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Decodes the double-escaped HTML entities Greenhouse's API returns (content is HTML, itself HTML-entity-encoded). */
export function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}
