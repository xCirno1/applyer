import { describe, it, expect } from 'vitest'
import { sanitizeDescriptionHtml, htmlToPlainText, decodeHtmlEntities } from './htmlContent'

describe('sanitizeDescriptionHtml', () => {
  it('keeps allowed formatting tags', () => {
    const out = sanitizeDescriptionHtml('<p>Hello <strong>world</strong></p><ul><li>One</li></ul>')
    expect(out).toContain('<p>Hello <strong>world</strong></p>')
    expect(out).toContain('<ul><li>One</li></ul>')
  })

  it('strips script tags and inline event handlers entirely', () => {
    const out = sanitizeDescriptionHtml('<p onclick="evil()">hi</p><script>alert(1)</script>')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('alert(1)')
    expect(out).toContain('hi')
  })

  it('drops disallowed tags but keeps their text content', () => {
    const out = sanitizeDescriptionHtml('<iframe src="evil"></iframe><p>keep me</p>')
    expect(out).not.toContain('<iframe')
    expect(out).toContain('keep me')
  })

  it('forces rel=noopener and target=_blank on links, dropping other attributes', () => {
    const out = sanitizeDescriptionHtml('<a href="https://example.com" onclick="evil()" style="color:red">link</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('rel="noopener noreferrer"')
    expect(out).toContain('target="_blank"')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('style')
  })

  it('drops javascript: and other disallowed link schemes', () => {
    const out = sanitizeDescriptionHtml('<a href="javascript:alert(1)">click</a>')
    expect(out).not.toContain('javascript:')
  })

  it('allows mailto links', () => {
    const out = sanitizeDescriptionHtml('<a href="mailto:jobs@acme.com">email</a>')
    expect(out).toContain('mailto:jobs@acme.com')
  })
})

describe('htmlToPlainText', () => {
  it('strips all markup', () => {
    expect(htmlToPlainText('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('leaves no literal "&nbsp;" text in the output', () => {
    // sanitize-html's own text extraction already turns &nbsp; into a real
    // U+00A0 character before this module's `.replace(/&nbsp;/g, ' ')` runs,
    // so that replace is a no-op in practice — verify the visible text is
    // right (a single whitespace-ish char between "a" and "b"), not the
    // exact character, since it's actually U+00A0, not U+0020.
    const out = htmlToPlainText('<p>a&nbsp;b</p>')
    expect(out).not.toContain('&nbsp;')
    expect(out).toMatch(/^a\sb$/)
  })

  it('collapses trailing whitespace before newlines', () => {
    expect(htmlToPlainText('<p>line1   </p><p>line2</p>')).not.toMatch(/ +\n/)
  })

  it('collapses 3+ blank lines down to a single blank line', () => {
    const out = htmlToPlainText('<p>a</p><br/><br/><br/><br/><p>b</p>')
    expect(out).not.toMatch(/\n{3,}/)
  })

  it('trims leading/trailing whitespace', () => {
    expect(htmlToPlainText('  <p>text</p>  ')).toBe('text')
  })

  it('decodes the entities sanitize-html re-escapes on its way out', () => {
    // Tag stripping leaves sanitize-html's own escaping behind, so an "&"
    // in the posting would otherwise reach the agent as the literal text
    // "&amp;" — very common in job data ("Sales & Marketing", "R&D").
    expect(htmlToPlainText('<p>Sales &amp; Marketing. R&amp;D a plus.</p>')).toBe(
      'Sales & Marketing. R&D a plus.'
    )
  })

  it('decodes escaped angle brackets that came from literal text, not markup', () => {
    expect(htmlToPlainText('<p>Use the &lt;input&gt; element</p>')).toBe('Use the <input> element')
  })

  it('undoes exactly one layer of escaping, leaving double-encoded text as written', () => {
    // The posting literally says "&lt;" (a company describing markup). The
    // parser decodes the outer layer to "&lt;", the serializer escapes it
    // back to "&amp;lt;", and this must land on "&lt;" — decoding twice
    // would silently rewrite the posting's own words.
    expect(htmlToPlainText('<p>write &amp;lt; to escape it</p>')).toBe('write &lt; to escape it')
  })

  it('leaves entities the sanitizer already turned into real characters alone', () => {
    // &mdash;/&copy; are decoded by the parser, not re-escaped on output, so
    // they arrive here as real characters and must pass through untouched.
    expect(htmlToPlainText('<p>a &mdash; b &copy; c</p>')).toBe('a — b © c')
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes the standard five HTML entities', () => {
    expect(decodeHtmlEntities('&amp;&lt;&gt;&quot;&#39;')).toBe(`&<>"'`)
  })

  it('undoes exactly one layer of encoding on double-encoded input', () => {
    // A description that literally contains the text "&lt;" (a company
    // describing template syntax, say) arrives from Greenhouse encoded once,
    // as "&amp;lt;". Decoding that one layer has to stop at "&lt;" — the
    // sequence only exists because the &amp; in front of it was decoded, so
    // it was never an entity in the input.
    expect(decodeHtmlEntities('&amp;lt;')).toBe('&lt;')
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;')
    expect(decodeHtmlEntities('&amp;quot;')).toBe('&quot;')
  })

  it('decodes each entity in place, independent of the order they appear in', () => {
    expect(decodeHtmlEntities('&lt;p&gt;a &amp; b&lt;/p&gt;')).toBe('<p>a & b</p>')
  })

  it('leaves entities it does not know how to decode alone', () => {
    // Only the five Greenhouse encodes are in scope here; anything else is
    // real content of the underlying HTML and belongs to the sanitizer.
    expect(decodeHtmlEntities('&nbsp;&copy;&#8212;')).toBe('&nbsp;&copy;&#8212;')
  })

  it('leaves a bare ampersand and a truncated entity untouched', () => {
    expect(decodeHtmlEntities('R&D')).toBe('R&D')
    expect(decodeHtmlEntities('&amp')).toBe('&amp')
  })

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('no entities here')).toBe('no entities here')
  })
})
