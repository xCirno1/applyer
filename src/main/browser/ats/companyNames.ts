/**
 * The legal-form words that sit at the end of a company's registered name.
 *
 * Two things need this list and neither can be right without it: a board slug
 * never carries the suffix ("Acme Inc." is `acme`), and the same employer is
 * written "Acme" on its own board and "Acme Inc." on an aggregator, which is
 * the difference between spotting a duplicate posting and showing it twice.
 */
export const LEGAL_SUFFIXES = new Set([
  'inc',
  'incorporated',
  'llc',
  'ltd',
  'limited',
  'plc',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'ag',
  'sa',
  'sas',
  'bv',
  'nv',
  'ab',
  'as',
  'oy',
  'pty',
  'pte',
  'kk',
  'srl',
  'spa'
])

/**
 * Drops a trailing legal form, but never the whole name — "Ltd" on its own is
 * some company's actual name as far as we can tell, and returning nothing
 * would make every such row match every other.
 */
export function stripLegalSuffix(words: readonly string[]): string[] {
  if (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) return words.slice(0, -1)
  return [...words]
}
