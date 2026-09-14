import { describe, expect, it } from 'vitest'
import type { ResumeContent } from '../types/resume'
import { SAMPLE_RESUME_CONTENT } from './sampleContent'
import { annotateResumeDiff, renderResumeDiffHtml } from './diffRender'

function body(html: string): string {
  return html.slice(html.indexOf('<body>'))
}

function variantOf(): ResumeContent {
  const variant = structuredClone(SAMPLE_RESUME_CONTENT)
  variant.header.headline = 'Payments Engineer'
  const experience = variant.sections.find((section) => section.id === 's-experience')!
  if (experience.layout.kind === 'entries') {
    const first = experience.layout.entries[0]!
    first.bullets = [first.bullets[0]!, 'Owned the ledger on-call rotation.']
    first.meta = 'Remote'
  }
  variant.sections = variant.sections.filter((section) => section.id !== 's-certs')
  variant.sections.push({ id: 's-highlights', title: 'Highlights', layout: { kind: 'list', items: ['Ledger service'] } })
  return variant
}

describe('renderResumeDiffHtml', () => {
  it('renders an identical variant with no marks', () => {
    const html = renderResumeDiffHtml(SAMPLE_RESUME_CONTENT, SAMPLE_RESUME_CONTENT, 'classic', 'letter')
    expect(html).not.toContain('<ins')
    expect(html).not.toContain('<del')
    expect(html).toContain('ins.diff-add')
  })

  it('marks changed fields, added and removed bullets, and whole sections', () => {
    const html = body(renderResumeDiffHtml(SAMPLE_RESUME_CONTENT, variantOf(), 'classic', 'letter'))
    expect(html).toContain('<del class="diff-del">Software Engineer</del> <ins class="diff-add">Payments Engineer</ins>')
    expect(html).toContain('<ins class="diff-add">Owned the ledger on-call rotation.</ins>')
    expect(html).toContain('<del class="diff-del">Cut p99 authorization latency')
    expect(html).toContain('<del class="diff-del">Portland, OR</del> <ins class="diff-add">Remote</ins>')
    // The dropped section is still on the page, struck through.
    expect(html).toContain('<del class="diff-del">Certifications</del>')
    expect(html).toContain('<del class="diff-del">AWS Solutions Architect Associate</del>')
    expect(html).toContain('<ins class="diff-add">Highlights</ins>')
    expect(html).toContain('<ins class="diff-add">Ledger service</ins>')
    // Untouched text is left alone.
    expect(html).toContain('<div class="entry-title"><span>Senior Software Engineer</span></div>')
  })

  it('shows a link whose destination changed behind unchanged text', () => {
    const variant = structuredClone(SAMPLE_RESUME_CONTENT)
    const web = variant.header.contacts.find((contact) => contact.id === 'c-web')!
    web.url = 'https://alex.example.org'
    const experience = variant.sections.find((section) => section.id === 's-experience')!
    if (experience.layout.kind === 'entries') experience.layout.entries[0]!.url = 'https://employer.example.com'
    const html = body(renderResumeDiffHtml(SAMPLE_RESUME_CONTENT, variant, 'classic', 'letter'))
    expect(html).toContain('alexmorgan.example.com <del class="diff-del">https://alexmorgan.example.com</del> <ins class="diff-add">https://alex.example.org</ins>')
    expect(html).toContain('href="https://alex.example.org/"')
    expect(html).toContain('Senior Software Engineer <ins class="diff-add">https://employer.example.com</ins>')
  })

  it('diffs prose word by word', () => {
    const variant = structuredClone(SAMPLE_RESUME_CONTENT)
    const summary = variant.sections.find((section) => section.layout.kind === 'text')!
    if (summary.layout.kind === 'text') summary.layout.body = summary.layout.body.replace('six years', 'seven years')
    const html = body(renderResumeDiffHtml(SAMPLE_RESUME_CONTENT, variant, 'compact', 'a4'))
    expect(html).toContain('<del class="diff-del">six</del> <ins class="diff-add">seven</ins> years')
  })

  it('shows a layout change as the old section struck and the new one added', () => {
    const variant = structuredClone(SAMPLE_RESUME_CONTENT)
    const certs = variant.sections.find((section) => section.id === 's-certs')!
    certs.layout = { kind: 'text', body: 'AWS and CKA certified.' }
    const annotated = annotateResumeDiff(SAMPLE_RESUME_CONTENT, variant)
    const ids = annotated.sections.map((section) => section.id)
    expect(ids).toContain('s-certs:removed')
    expect(ids.indexOf('s-certs:removed')).toBe(ids.indexOf('s-certs') - 1)
  })

  it('never lets marker characters in user text open a highlight, and keeps the title clean', () => {
    const master = structuredClone(SAMPLE_RESUME_CONTENT)
    master.header.fullName = 'Alex\u0001 Morgan'
    const variant = structuredClone(master)
    variant.header.fullName = 'Alex Morgan-Lee'
    const html = renderResumeDiffHtml(master, variant, 'modern', 'letter')
    expect(html).toContain('<title>Alex Morgan-Lee</title>')
    expect(html).not.toContain('<ins class="diff-add"> Morgan')
    expect(html).toContain('<h1><del class="diff-del">Alex Morgan</del> <ins class="diff-add">Alex Morgan-Lee</ins></h1>')
    // eslint-disable-next-line no-control-regex
    expect(html).not.toMatch(/[\u0001-\u0004]/)
  })
})
