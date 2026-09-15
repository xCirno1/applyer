import { describe, it, expect } from 'vitest'
import { JSDOM } from 'jsdom'
import { collectJsonLdScripts, extractPostingDom } from './posting'
import { extractSeekSearchCards } from './seek'
import { extractJoraSearchCards } from './jora'
import { extractProspleEmployer, extractProspleSearchCards } from './prosple'

function documentOf(html: string): Document {
  return new JSDOM(html).window.document
}

/**
 * Every extractor is handed to `page.evaluate`, which serializes it with
 * `Function#toString`; a reference to anything outside the function body
 * would be an undefined identifier inside the page. The check here is the
 * cheap one: the source must not mention `import` or `require`, and each
 * must still run against a bare document with no help from this module.
 */
describe('page-side extractors are self-contained', () => {
  it.each([
    ['collectJsonLdScripts', collectJsonLdScripts],
    ['extractPostingDom', extractPostingDom],
    ['extractSeekSearchCards', extractSeekSearchCards],
    ['extractJoraSearchCards', extractJoraSearchCards],
    ['extractProspleSearchCards', extractProspleSearchCards],
    ['extractProspleEmployer', extractProspleEmployer]
  ])('%s', (_name, fn) => {
    const source = fn.toString()
    expect(source).not.toMatch(/\bimport\b|\brequire\(/)
  })
})

describe('collectJsonLdScripts', () => {
  it('returns every ld+json body and skips empty and other script types', () => {
    const doc = documentOf(`
      <script type="application/ld+json">{"@type":"JobPosting"}</script>
      <script type="application/ld+json">   </script>
      <script type="text/javascript">var x = 1</script>
      <script type="application/ld+json">[{"@type":"BreadcrumbList"}]</script>
    `)
    expect(collectJsonLdScripts(doc)).toEqual(['{"@type":"JobPosting"}', '[{"@type":"BreadcrumbList"}]'])
  })
})

describe('extractPostingDom', () => {
  const selectors = {
    title: ['h1.missing', 'h1'],
    company: ['.company'],
    location: ['.location'],
    salary: ['.salary'],
    description: ['.too-short', '.description']
  }

  it('takes the first selector with content for each field', () => {
    const doc = documentOf(`
      <h1>  Backend   Engineer </h1>
      <div class="company">Acme</div>
      <div class="too-short">tiny</div>
      <div class="description"><p>${'Build things. '.repeat(10)}</p></div>
    `)
    const dom = extractPostingDom(selectors, doc)
    expect(dom.title).toBe('Backend Engineer')
    expect(dom.company).toBe('Acme')
    expect(dom.location).toBeNull()
    expect(dom.salary).toBeNull()
    expect(dom.descriptionHtml).toContain('<p>Build things.')
  })

  it('skips a container whose text is too short to be a description', () => {
    const doc = documentOf('<div class="description">Apply now</div>')
    expect(extractPostingDom(selectors, doc).descriptionHtml).toBeNull()
  })

  it('tolerates an invalid selector instead of throwing inside the page', () => {
    const doc = documentOf('<h1>Title</h1>')
    const dom = extractPostingDom({ ...selectors, title: ['h1[', 'h1'] }, doc)
    expect(dom.title).toBe('Title')
  })
})

describe('extractSeekSearchCards', () => {
  const page = `
    <article data-automation="normalJob" data-job-id="81234567">
      <h3><a data-automation="jobTitle" href="/job/81234567?type=standard&ref=search">Senior Backend Engineer</a></h3>
      <a data-automation="jobCompany" href="/Acme-jobs">Acme Pty Ltd</a>
      <a data-automation="jobLocation" href="/jobs/in-Sydney">Sydney NSW</a>
      <a data-automation="jobLocation" href="/jobs/in-CBD">CBD, Inner West &amp; Eastern Suburbs</a>
      <span data-automation="jobSalary">$150,000 - $170,000</span>
      <span data-automation="jobShortDescription">Build the platform that powers our marketplace.</span>
      <span data-automation="jobListingDate">3d ago</span>
    </article>
    <article data-automation="premiumJob">
      <h3><a data-automation="jobTitle" href="/job/81234568">Data Engineer</a></h3>
      <a data-automation="jobCompany">Beta Ltd</a>
      <span data-automation="jobListingDate">Today</span>
    </article>
    <article data-automation="normalJob" data-job-id="81234569">
      <h3><a data-automation="jobTitle" href="/job/81234569">Untitled company</a></h3>
    </article>
  `

  it('reads each card, joining the location parts and taking the id from the card or the link', () => {
    const cards = extractSeekSearchCards(documentOf(page))
    expect(cards).toHaveLength(3)
    expect(cards[0]).toEqual({
      id: '81234567',
      title: 'Senior Backend Engineer',
      company: 'Acme Pty Ltd',
      location: 'Sydney NSW, CBD, Inner West & Eastern Suburbs',
      snippet: 'Build the platform that powers our marketplace.',
      salary: '$150,000 - $170,000',
      listed: '3d ago'
    })
    expect(cards[1]).toEqual({
      id: '81234568',
      title: 'Data Engineer',
      company: 'Beta Ltd',
      location: null,
      snippet: null,
      salary: null,
      listed: 'Today'
    })
    expect(cards[2]?.company).toBeNull()
  })

  it('returns nothing on a page with no result articles', () => {
    expect(extractSeekSearchCards(documentOf('<main><h1>No results</h1></main>'))).toEqual([])
  })
})

describe('extractJoraSearchCards', () => {
  const page = `
    <div class="job-card result">
      <h2 class="job-title"><a class="job-link" href="/job/Backend-Engineer-0a1b2c3d4e5f60718293a4b5c6d7e8f9?from_url=x&sp=serp">Backend Engineer</a></h2>
      <span class="job-company">Acme</span>
      <a class="job-location">Melbourne VIC</a>
      <div class="job-abstract">Ship the thing.</div>
      <div class="job-listed-date">2 days ago</div>
    </div>
    <article data-job-id="abc">
      <h3><a href="https://au.jora.com/job/Data-Engineer-ffffffffffffffffffffffffffffffff">Data Engineer</a></h3>
      <div class="company">Beta</div>
    </article>
  `

  it('reads the named fields and falls back to a heading link', () => {
    const cards = extractJoraSearchCards(documentOf(page))
    expect(cards).toEqual([
      {
        href: '/job/Backend-Engineer-0a1b2c3d4e5f60718293a4b5c6d7e8f9?from_url=x&sp=serp',
        title: 'Backend Engineer',
        company: 'Acme',
        location: 'Melbourne VIC',
        snippet: 'Ship the thing.',
        salary: null,
        listed: '2 days ago'
      },
      {
        href: 'https://au.jora.com/job/Data-Engineer-ffffffffffffffffffffffffffffffff',
        title: 'Data Engineer',
        company: 'Beta',
        location: null,
        snippet: null,
        salary: null,
        listed: null
      }
    ])
  })
})

describe('extractProspleSearchCards', () => {
  const page = `
    <ul>
      <li class="SearchResultCard">
        <h3><a href="/graduate-employers/deloitte-australia/jobs-internships/2027-graduate-program-audit?ref=search">2027 Graduate Program, Audit</a></h3>
        <a href="/graduate-employers/deloitte-australia">Deloitte Australia</a>
        <span class="LocationTag">Sydney, Melbourne</span>
        <p>Join a team that audits the largest companies in the country.</p>
        <span class="ClosingDate">Closes 30 Sep 2026</span>
      </li>
      <li class="SearchResultCard">
        <a href="/graduate-employers/atlassian/jobs-internships/summer-internship">Summer Internship</a>
        <a href="/graduate-employers/atlassian/jobs-internships/summer-internship">See more</a>
      </li>
    </ul>
    <a href="/graduate-employers/deloitte-australia/jobs-internships/2027-graduate-program-audit">Duplicate link elsewhere</a>
  `

  it('anchors on the posting link and reads the employer from the sibling profile link', () => {
    const cards = extractProspleSearchCards(documentOf(page))
    expect(cards).toHaveLength(2)
    expect(cards[0]).toEqual({
      href: '/graduate-employers/deloitte-australia/jobs-internships/2027-graduate-program-audit?ref=search',
      title: '2027 Graduate Program, Audit',
      company: 'Deloitte Australia',
      location: 'Sydney, Melbourne',
      snippet: 'Join a team that audits the largest companies in the country.',
      closes: 'Closes 30 Sep 2026'
    })
    expect(cards[1]).toEqual({
      href: '/graduate-employers/atlassian/jobs-internships/summer-internship',
      title: 'Summer Internship',
      company: null,
      location: null,
      snippet: null,
      closes: null
    })
  })

  it('does not treat the posting link itself as the employer link', () => {
    const cards = extractProspleSearchCards(documentOf(page))
    expect(cards[1]?.company).toBeNull()
  })
})

describe('extractProspleEmployer', () => {
  it('returns the first employer profile link that is not a posting link', () => {
    const doc = documentOf(`
      <a href="/graduate-employers/acme/jobs-internships/role">Role</a>
      <a href="/graduate-employers/acme">Acme Graduate Careers</a>
    `)
    expect(extractProspleEmployer(doc)).toBe('Acme Graduate Careers')
  })

  it('returns null with no such link', () => {
    expect(extractProspleEmployer(documentOf('<h1>Role</h1>'))).toBeNull()
  })
})
