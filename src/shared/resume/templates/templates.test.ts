import { describe, expect, it } from 'vitest'
import { RESUME_TEMPLATE_IDS, type ResumeContent } from '../../types/resume'
import { SAMPLE_RESUME_CONTENT } from '../sampleContent'
import { RESUME_TEMPLATES, renderResumeHtml } from './index'

const HOSTILE: ResumeContent = {
  header: {
    fullName: '<script>alert(1)</script>',
    headline: 'a "quoted" & <b>bold</b>',
    contacts: [
      { id: 'c1', label: 'Site', value: 'click', url: 'javascript:alert(1)' },
      { id: 'c2', label: 'Site', value: 'ok', url: 'https://example.com/a?b=1&c=2' },
      { id: 'c3', label: 'Mail', value: 'mailto:x@y.z' }
    ]
  },
  sections: [
    {
      id: 's1',
      title: '<img src=x onerror=alert(1)>',
      layout: {
        kind: 'entries',
        entries: [{ id: 'e1', title: 'T', url: 'file:///etc/passwd', bullets: ['<i>x</i>', '   ', 'y'] }]
      }
    },
    { id: 's2', title: 'Empty', layout: { kind: 'list', items: ['  '] } },
    { id: 's3', title: 'Skills', layout: { kind: 'groups', groups: [{ id: 'g1', label: 'L', items: ['a<b', 'c'] }] } },
    { id: 's4', title: 'Text', layout: { kind: 'text', body: '' } }
  ]
}

describe('resume templates', () => {
  it('every template id has a template and renders the sample as a full document', () => {
    for (const id of RESUME_TEMPLATE_IDS) {
      expect(RESUME_TEMPLATES[id].id).toBe(id)
      for (const pageSize of ['letter', 'a4'] as const) {
        const html = renderResumeHtml(SAMPLE_RESUME_CONTENT, id, pageSize)
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
        expect(html).toContain('Alex Morgan')
        expect(html).toContain('Northwind Payments')
        expect(html).toContain('2022 - Present')
        expect(html).toContain('TypeScript, Go, SQL, Python')
        expect(html).toContain('AWS Solutions Architect Associate')
        expect(html).toContain(pageSize === 'letter' ? 'size: 8.5in 11in' : 'size: 8.27in 11.69in')
        expect(html).not.toMatch(/<script/i)
        expect(html).not.toMatch(/<link/i)
      }
    }
  })

  it('escapes every string and never emits unsafe hrefs', () => {
    for (const id of RESUME_TEMPLATE_IDS) {
      const html = renderResumeHtml(HOSTILE, id, 'letter')
      expect(html).not.toContain('<script>alert')
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
      expect(html).not.toContain('<img src=x')
      expect(html).not.toContain('javascript:')
      expect(html).not.toContain('file:///')
      expect(html).toContain('href="https://example.com/a?b=1&amp;c=2"')
      expect(html).toContain('href="mailto:x@y.z"')
      expect(html).toContain('&lt;i&gt;x&lt;/i&gt;')
      expect(html).toContain('a&lt;b')
      // The `<title>` is escaped too.
      expect(html).toContain('<title>&lt;script&gt;alert(1)&lt;/script&gt;</title>')
    }
  })

  it('drops empty sections and blank bullets', () => {
    const html = renderResumeHtml(HOSTILE, 'classic', 'letter')
    expect(html).not.toContain('>Empty<')
    expect(html).not.toContain('>Text<')
    expect((html.match(/<li>/g) ?? []).length).toBe(2)
  })

  it('renders entries without dates or subtitles', () => {
    const content: ResumeContent = {
      header: { fullName: 'A', contacts: [] },
      sections: [{ id: 's', title: 'Work', layout: { kind: 'entries', entries: [{ id: 'e', title: 'Only a title', bullets: [] }] } }]
    }
    for (const id of RESUME_TEMPLATE_IDS) {
      const html = renderResumeHtml(content, id, 'a4')
      const body = html.slice(html.indexOf('<body>'))
      expect(body).toContain('Only a title')
      expect(body).not.toContain('class="entry-dates"')
      expect(body).not.toContain('class="entry-sub"')
      expect(body).not.toContain('class="entry-side"')
    }
  })

  it('prints the location under the dates, not beside the subtitle', () => {
    const content: ResumeContent = {
      header: { fullName: 'A', contacts: [] },
      sections: [
        {
          id: 's',
          title: 'Work',
          layout: {
            kind: 'entries',
            entries: [{ id: 'e', title: 'Engineer', subtitle: 'Northwind', meta: 'Portland, OR', start: '2021', end: 'Present', bullets: [] }]
          }
        }
      ]
    }
    for (const id of RESUME_TEMPLATE_IDS) {
      const body = renderResumeHtml(content, id, 'letter').replace(/\s+/g, ' ')
      expect(body).toContain('<div class="entry-side"><div class="entry-dates">2021 - Present</div><div class="entry-meta">Portland, OR</div></div>')
      expect(body).toContain('<div class="entry-sub">Northwind</div>')
      expect(body).not.toContain(' · ')
    }
  })

  it('drops a colon typed at the end of a group label', () => {
    const content: ResumeContent = {
      header: { fullName: 'A', contacts: [] },
      sections: [
        {
          id: 's',
          title: 'Skills',
          layout: {
            kind: 'groups',
            groups: [
              { id: 'g1', label: 'Languages:', items: ['Python', 'Rust'] },
              { id: 'g2', label: 'Tools: ', items: ['Git'] },
              { id: 'g3', label: 'Frameworks', items: ['React'] }
            ]
          }
        }
      ]
    }
    const body = renderResumeHtml(content, 'classic', 'letter')
    expect(body).toContain('<span class="group-label">Languages</span>')
    expect(body).toContain('<span class="group-label">Tools</span>')
    expect(body).toContain('<span class="group-label">Frameworks</span>')
    expect(body).not.toContain('Languages:</span>')
  })

  it('applies the chosen typography after the template CSS, leaving the template alone when unset', () => {
    const plain = renderResumeHtml(SAMPLE_RESUME_CONTENT, 'classic', 'letter')
    const styled = renderResumeHtml(SAMPLE_RESUME_CONTENT, 'classic', 'letter', { fontFamily: 'calibri', fontSize: 12 })
    expect(plain).toEqual(renderResumeHtml(SAMPLE_RESUME_CONTENT, 'classic', 'letter', {}))
    expect(styled).toContain('body { font-family: Calibri, Carlito')
    expect(styled).toContain('font-size: 12pt; }')
    expect(styled.lastIndexOf('font-size: 12pt')).toBeGreaterThan(styled.indexOf("font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt"))
    // Every other size is relative to the body, so the setting scales the whole page.
    const css = styled.slice(styled.indexOf('<style>'), styled.indexOf('</style>'))
    expect(css.match(/font-size: [\d.]+pt/g)).toHaveLength(2)
  })

  it('styles links plain, blue or underlined by setting', () => {
    const plain = renderResumeHtml(SAMPLE_RESUME_CONTENT, 'modern', 'letter', { linkStyle: 'plain' })
    const blue = renderResumeHtml(SAMPLE_RESUME_CONTENT, 'modern', 'letter', { linkStyle: 'blue' })
    const underline = renderResumeHtml(SAMPLE_RESUME_CONTENT, 'modern', 'letter', { linkStyle: 'underline' })
    expect(plain).toEqual(renderResumeHtml(SAMPLE_RESUME_CONTENT, 'modern', 'letter'))
    expect(plain).not.toContain('#1a56b0')
    expect(blue).toContain('a { color: #1a56b0; }')
    expect(underline).toContain('a { text-decoration: underline;')
    expect(underline).not.toContain('#1a56b0')
  })

  it('prints a contact as written and links it when the url is safe', () => {
    const content: ResumeContent = {
      header: {
        fullName: 'A',
        contacts: [
          { id: 'c1', label: 'LinkedIn', value: 'LinkedIn', url: 'https://www.linkedin.com/in/jane/' },
          { id: 'c2', label: 'Website', value: 'https://jane.dev' },
          { id: 'c3', label: 'Email', value: 'jane@example.com', url: 'mailto:jane@example.com' },
          { id: 'c4', label: 'Phone', value: '+61 422 205 091' },
          { id: 'c5', label: 'GitHub', value: 'github.com/jane', url: 'https://github.com/jane' },
          { id: 'c6', label: 'Portfolio', value: 'Portfolio' }
        ]
      },
      sections: []
    }
    const body = renderResumeHtml(content, 'classic', 'letter')
    expect(body).toContain('href="https://www.linkedin.com/in/jane/">LinkedIn</a>')
    expect(body).toContain('href="https://jane.dev/">jane.dev</a>')
    expect(body).toContain('href="mailto:jane@example.com">jane@example.com</a>')
    expect(body).toContain('<span class="contact"><span>+61 422 205 091</span></span>')
    expect(body).toContain('href="https://github.com/jane">github.com/jane</a>')
    expect(body).toContain('<span class="contact"><span>Portfolio</span></span>')
  })
})
