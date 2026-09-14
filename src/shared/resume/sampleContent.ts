import type { ResumeContent } from '../types/resume'

/**
 * Placeholder content for the Templates tab thumbnails (before a master
 * exists) and for template tests. Deliberately generic and obviously fake so
 * nobody mistakes it for their own data.
 */
export const SAMPLE_RESUME_CONTENT: ResumeContent = {
  header: {
    fullName: 'Alex Morgan',
    headline: 'Software Engineer',
    contacts: [
      { id: 'c-email', label: 'Email', value: 'alex.morgan@example.com', url: 'mailto:alex.morgan@example.com' },
      { id: 'c-phone', label: 'Phone', value: '+1 555 010 2030' },
      { id: 'c-location', label: 'Location', value: 'Portland, OR' },
      { id: 'c-web', label: 'Website', value: 'alexmorgan.example.com', url: 'https://alexmorgan.example.com' }
    ]
  },
  sections: [
    {
      id: 's-summary',
      title: 'Summary',
      layout: {
        kind: 'text',
        body: 'Backend engineer with six years building payment and ledger systems. Led the migration of a monolith to event-driven services handling 40k transactions per minute.'
      }
    },
    {
      id: 's-experience',
      title: 'Experience',
      layout: {
        kind: 'entries',
        entries: [
          {
            id: 'e-1',
            title: 'Senior Software Engineer',
            subtitle: 'Northwind Payments',
            meta: 'Portland, OR',
            start: '2022',
            end: 'Present',
            bullets: [
              'Designed the ledger service that replaced nightly batch reconciliation with real-time settlement.',
              'Cut p99 authorization latency from 480 ms to 120 ms by moving fraud scoring off the request path.',
              'Mentored four engineers; two promoted to senior within eighteen months.'
            ]
          },
          {
            id: 'e-2',
            title: 'Software Engineer',
            subtitle: 'Contoso Logistics',
            meta: 'Remote',
            start: '2019',
            end: '2022',
            bullets: [
              'Built the route-optimization API used by 300 dispatchers across three regions.',
              'Introduced contract tests between twelve services, removing a class of release-day outages.'
            ]
          }
        ]
      }
    },
    {
      id: 's-education',
      title: 'Education',
      layout: {
        kind: 'entries',
        entries: [
          {
            id: 'e-3',
            title: 'B.S. Computer Science',
            subtitle: 'Oregon State University',
            start: '2015',
            end: '2019',
            bullets: []
          }
        ]
      }
    },
    {
      id: 's-skills',
      title: 'Skills',
      layout: {
        kind: 'groups',
        groups: [
          { id: 'g-1', label: 'Languages', items: ['TypeScript', 'Go', 'SQL', 'Python'] },
          { id: 'g-2', label: 'Infrastructure', items: ['PostgreSQL', 'Kafka', 'Kubernetes', 'Terraform'] }
        ]
      }
    },
    {
      id: 's-certs',
      title: 'Certifications',
      layout: { kind: 'list', items: ['AWS Solutions Architect Associate', 'CKA: Certified Kubernetes Administrator'] }
    }
  ]
}
