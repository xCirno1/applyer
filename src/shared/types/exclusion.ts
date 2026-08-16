export type ExcludedBy = 'user' | 'agent'

export interface ExclusionRecord {
  id: string
  url: string
  title: string | null
  company: string | null
  reason: string | null
  excludedBy: ExcludedBy
  createdAt: string
}

export interface ListExclusionsQuery {
  limit?: number
  offset?: number
  search?: string
}

export interface ListExclusionsResult {
  exclusions: ExclusionRecord[]
  total: number
}
