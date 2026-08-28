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

const ESCAPED_TEXT_REPLACEMENTS: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'"
}

const ESCAPED_TEXT_PATTERN = /&(?:amp|lt|gt|quot|#39);/g

/**
 * Undoes the escaping sanitize-html applies to its own text output.
 *
 * Its parser already decodes every entity in the source (`&mdash;` becomes a
 * real em dash, and so on), then re-escapes the few characters that would be
 * markup on the way out — so what is left in a tags-stripped result is
 * sanitize-html's own escaping, not the posting's.
 *
 * One pass over the string, never a chain of replaces: a chain feeds each
 * replacement into the next, so decoding `&amp;` first would expose `&lt;`
 * sequences that stand for literal text and decode those too. A description
 * that literally reads `&lt;` comes out of the sanitizer as `&amp;lt;` and
 * has to land on `&lt;`, not `<`.
 */
function decodeEscapedText(text: string): string {
  return text.replace(ESCAPED_TEXT_PATTERN, (entity) => ESCAPED_TEXT_REPLACEMENTS[entity] ?? entity)
}

/** Plain-text extraction for feeding to an LLM agent — no markup, no token waste. */
export function htmlToPlainText(html: string): string {
  const text = sanitizeHtmlLib(html, { allowedTags: [], allowedAttributes: {} })
  return decodeEscapedText(
    text
      .replace(/&nbsp;/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
  ).trim()
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
