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

const HTML_ENTITY_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'"
}

const HTML_ENTITY_PATTERN = /&(?:amp|lt|gt|quot|#39);/g

/**
 * Decodes the double-escaped HTML entities Greenhouse's API returns (content is HTML, itself HTML-entity-encoded).
 *
 * One pass over the original string, not a chain of `.replace()` calls: a
 * chain feeds each replacement's output into the next, so decoding `&amp;`
 * first exposes `&lt;` sequences that were never entities in the input.
 * Greenhouse applies exactly one layer of encoding, so a description that
 * literally reads `&lt;` arrives as `&amp;lt;` and must decode back to
 * `&lt;` — a chain would strip both layers and turn it into `<`.
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(HTML_ENTITY_PATTERN, (entity) => HTML_ENTITY_REPLACEMENTS[entity] ?? entity)
}
