import type { JobRecord } from '@shared/types/job'
import type { ExclusionRecord } from '@shared/types/exclusion'

type CsvValue = string | number | null | undefined

function escapeCsvField(value: CsvValue): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function rowToCsv(row: CsvValue[]): string {
  return row.map(escapeCsvField).join(',')
}

export function jobsToCsv(records: JobRecord[]): string {
  const header = [
    'Title',
    'Company',
    'Location',
    'URL',
    'Status',
    'Source',
    'Salary Range',
    'Match Score',
    'Application URL',
    'Apply Method',
    'Failure Tag',
    'Failure Message',
    'Queued At',
    'Filled At',
    'Submitted At'
  ]
  const lines = [rowToCsv(header)]
  for (const r of records) {
    lines.push(
      rowToCsv([
        r.title,
        r.company,
        r.location,
        r.url,
        r.status,
        r.source,
        r.salaryRange,
        r.matchScore,
        r.applicationUrl,
        r.applyMethod,
        r.failureTag,
        r.failureMessage,
        r.queuedAt,
        r.filledAt,
        r.submittedAt
      ])
    )
  }
  return lines.join('\r\n')
}

export function exclusionsToCsv(records: ExclusionRecord[]): string {
  const header = ['URL', 'Title', 'Company', 'Reason', 'Excluded By', 'Created At']
  const lines = [rowToCsv(header)]
  for (const r of records) {
    lines.push(rowToCsv([r.url, r.title, r.company, r.reason, r.excludedBy, r.createdAt]))
  }
  return lines.join('\r\n')
}
