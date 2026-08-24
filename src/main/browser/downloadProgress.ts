export interface DownloadProgress {
  percent: number
  totalSize: string
}

/**
 * Parses a line of Playwright's non-TTY install progress output, e.g.
 * "|■■■■    |  40% of 390.2 MiB". Returns null for anything else (banner
 * lines, blank lines, a chunk that doesn't contain a complete match).
 */
export function parseDownloadProgressLine(chunk: string): DownloadProgress | null {
  const match = chunk.match(/(\d{1,3})%\s+of\s+([\d.]+\s*\wi?B)/)
  if (!match || match[1] === undefined || match[2] === undefined) return null
  return { percent: Number(match[1]), totalSize: match[2] }
}
