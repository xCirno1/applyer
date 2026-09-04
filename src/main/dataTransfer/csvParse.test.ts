import { describe, it, expect } from 'vitest'
import { cellAt, parseCsv, sniffDelimiter } from './csvParse'

describe('sniffDelimiter', () => {
  it('picks the most frequent candidate on the header line', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';')
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t')
    expect(sniffDelimiter('a|b|c')).toBe('|')
  })

  it('ignores delimiters inside quoted headers', () => {
    expect(sniffDelimiter('"last, first";age')).toBe(';')
  })

  it('falls back to a comma for a single-column file', () => {
    expect(sniffDelimiter('token\nacme')).toBe(',')
  })

  it('only looks at the first line', () => {
    expect(sniffDelimiter('a,b\n1;2;3;4;5;6')).toBe(',')
  })
})

describe('parseCsv', () => {
  it('reads a header and rows', () => {
    const parsed = parseCsv('provider,token\ngreenhouse,acme\nlever,globex', 100)
    expect(parsed.headers).toEqual(['provider', 'token'])
    expect(parsed.rows).toEqual([
      ['greenhouse', 'acme'],
      ['lever', 'globex']
    ])
    expect(parsed.truncated).toBe(false)
  })

  it('strips a UTF-8 BOM so the first header keeps its name', () => {
    expect(parseCsv('﻿provider,token\ngreenhouse,acme', 100).headers).toEqual(['provider', 'token'])
  })

  it('handles quoted fields, escaped quotes and embedded separators', () => {
    const parsed = parseCsv('company,token\n"Acme, Inc.",acme\n"He said ""hi""",globex', 100)
    expect(parsed.rows).toEqual([
      ['Acme, Inc.', 'acme'],
      ['He said "hi"', 'globex']
    ])
  })

  it('keeps newlines inside a quoted field', () => {
    const parsed = parseCsv('a,b\n"line1\nline2",x', 100)
    expect(parsed.rows).toEqual([['line1\nline2', 'x']])
  })

  it('accepts CRLF, LF and CR line endings in one file', () => {
    const parsed = parseCsv('a,b\r\n1,2\n3,4\r5,6', 100)
    expect(parsed.rows).toEqual([
      ['1', '2'],
      ['3', '4'],
      ['5', '6']
    ])
  })

  it('reads a last row that has no trailing newline', () => {
    expect(parseCsv('a,b\n1,2', 100).rows).toEqual([['1', '2']])
  })

  it('drops blank rows rather than yielding empty ones', () => {
    const parsed = parseCsv('a,b\n1,2\n\n\n3,4\n', 100)
    expect(parsed.rows).toEqual([
      ['1', '2'],
      ['3', '4']
    ])
  })

  it('tolerates rows shorter or longer than the header', () => {
    const parsed = parseCsv('a,b,c\n1\n1,2,3,4', 100)
    expect(parsed.rows).toEqual([['1'], ['1', '2', '3', '4']])
  })

  it('treats a quote inside an unquoted value as data', () => {
    expect(parseCsv('a\n27" monitor', 100).rows).toEqual([['27" monitor']])
  })

  it('stops at the row cap and reports the truncation', () => {
    const parsed = parseCsv('a\n1\n2\n3\n4', 2)
    expect(parsed.rows).toEqual([['1'], ['2']])
    expect(parsed.truncated).toBe(true)
  })

  it('does not report truncation when the last row lands exactly on the cap', () => {
    const parsed = parseCsv('a\n1\n2\n', 2)
    expect(parsed.rows).toEqual([['1'], ['2']])
    expect(parsed.truncated).toBe(false)
  })

  it('returns nothing for an empty file', () => {
    const parsed = parseCsv('', 100)
    expect(parsed.headers).toEqual([])
    expect(parsed.rows).toEqual([])
  })

  it('returns a header with no rows for a header-only file', () => {
    const parsed = parseCsv('provider,token\n', 100)
    expect(parsed.headers).toEqual(['provider', 'token'])
    expect(parsed.rows).toEqual([])
  })

  it('parses semicolon-delimited files without being told', () => {
    const parsed = parseCsv('provider;token;open\ngreenhouse;acme;12', 100)
    expect(parsed.delimiter).toBe(';')
    expect(parsed.rows).toEqual([['greenhouse', 'acme', '12']])
  })
})

describe('cellAt', () => {
  it('trims the value', () => {
    expect(cellAt(['  acme  '], 0)).toBe('acme')
  })

  it('returns an empty string for an unmapped or out-of-range column', () => {
    expect(cellAt(['acme'], null)).toBe('')
    expect(cellAt(['acme'], 4)).toBe('')
    expect(cellAt(['acme'], -1)).toBe('')
  })
})
