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
})

describe('decodeHtmlEntities', () => {
  it('decodes the standard five HTML entities', () => {
    expect(decodeHtmlEntities('&amp;&lt;&gt;&quot;&#39;')).toBe(`&<>"'`)
  })

  it('cascades through double-encoded input, since each .replace runs over the previous result', () => {
    // The literal text "&lt;" is itself double-encoded as "&amp;lt;". Because
    // the &amp;->& replacement runs first and feeds the &lt;->< replacement
    // that follows it in the same chain, this decodes all the way to "<"
    // rather than stopping at "&lt;" — i.e. the function is not safe to
    // apply to already-decoded or double-encoded input.
    expect(decodeHtmlEntities('&amp;lt;')).toBe('<')
  })

  it('leaves plain text untouched', () => {
    expect(decodeHtmlEntities('no entities here')).toBe('no entities here')
  })
})
