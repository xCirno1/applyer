import { describe, expect, it } from 'vitest'
import { parseMarkdown, type BlockNode } from './markdown'

function text(value: string): { type: 'text'; value: string } {
  return { type: 'text', value }
}

describe('parseMarkdown: paragraphs and line breaks', () => {
  it('parses a single paragraph', () => {
    expect(parseMarkdown('hello world')).toEqual([{ type: 'paragraph', children: [text('hello world')] }])
  })

  it('separates paragraphs on a blank line', () => {
    const blocks = parseMarkdown('first\n\nsecond')
    expect(blocks).toEqual([
      { type: 'paragraph', children: [text('first')] },
      { type: 'paragraph', children: [text('second')] }
    ])
  })

  it('renders every line break within a paragraph as a hard break', () => {
    const blocks = parseMarkdown('line one\nline two')
    expect(blocks).toEqual([
      { type: 'paragraph', children: [text('line one'), { type: 'break' }, text('line two')] }
    ])
  })

  it('handles CRLF and lone-CR input the same as LF', () => {
    expect(parseMarkdown('a\r\nb')).toEqual(parseMarkdown('a\nb'))
    expect(parseMarkdown('a\rb')).toEqual(parseMarkdown('a\nb'))
  })
})

describe('parseMarkdown: headings', () => {
  it('parses level 1-3 headings', () => {
    expect(parseMarkdown('# Title')).toEqual([{ type: 'heading', level: 1, children: [text('Title')] }])
    expect(parseMarkdown('## Sub')).toEqual([{ type: 'heading', level: 2, children: [text('Sub')] }])
    expect(parseMarkdown('### Sub sub')).toEqual([{ type: 'heading', level: 3, children: [text('Sub sub')] }])
  })

  it('degrades a level 4+ heading to a plain paragraph', () => {
    const blocks = parseMarkdown('#### Not a heading')
    expect(blocks).toEqual([{ type: 'paragraph', children: [text('#### Not a heading')] }])
  })

  it('requires a space (or nothing) after the hashes', () => {
    const blocks = parseMarkdown('#NotAHeading')
    expect(blocks).toEqual([{ type: 'paragraph', children: [text('#NotAHeading')] }])
  })

  it('allows an empty heading', () => {
    expect(parseMarkdown('###')).toEqual([{ type: 'heading', level: 3, children: [] }])
  })
})

describe('parseMarkdown: horizontal rules', () => {
  it('recognises --- *** and ___', () => {
    for (const rule of ['---', '***', '___', '- - -', '* * *']) {
      expect(parseMarkdown(rule)).toEqual([{ type: 'hr' }])
    }
  })

  it('does not treat a short dash run as an hr', () => {
    expect(parseMarkdown('--')).not.toEqual([{ type: 'hr' }])
  })
})

describe('parseMarkdown: fenced code', () => {
  it('parses a fenced block with a language tag', () => {
    const blocks = parseMarkdown('```ts\nconst x = 1\n```')
    expect(blocks).toEqual([{ type: 'code', language: 'ts', value: 'const x = 1' }])
  })

  it('parses a fenced block with no language', () => {
    const blocks = parseMarkdown('```\nplain\n```')
    expect(blocks).toEqual([{ type: 'code', language: null, value: 'plain' }])
  })

  it('never runs inline parsing inside a fence, even on markdown-looking text', () => {
    const blocks = parseMarkdown('```\n**not bold** [not a link](https://example.com)\n```')
    expect(blocks).toEqual([{ type: 'code', language: null, value: '**not bold** [not a link](https://example.com)' }])
  })

  it('is streaming-safe: an unterminated fence still renders as a code block through to the end of input', () => {
    const blocks = parseMarkdown('```ts\nconst x = 1\nconst y =')
    expect(blocks).toEqual([{ type: 'code', language: 'ts', value: 'const x = 1\nconst y =' }])
  })

  it('accepts ~~~ fences too', () => {
    expect(parseMarkdown('~~~\nhi\n~~~')).toEqual([{ type: 'code', language: null, value: 'hi' }])
  })
})

describe('parseMarkdown: blockquotes', () => {
  it('parses a simple blockquote as nested blocks', () => {
    const blocks = parseMarkdown('> quoted text')
    expect(blocks).toEqual([{ type: 'blockquote', children: [{ type: 'paragraph', children: [text('quoted text')] }] }])
  })

  it('supports a blockquote spanning multiple lines', () => {
    const blocks = parseMarkdown('> line one\n> line two')
    expect(blocks).toEqual([
      { type: 'blockquote', children: [{ type: 'paragraph', children: [text('line one'), { type: 'break' }, text('line two')] }] }
    ])
  })

  it('stops the blockquote at the first non-quoted line', () => {
    const blocks = parseMarkdown('> quoted\nnot quoted')
    expect(blocks).toEqual([
      { type: 'blockquote', children: [{ type: 'paragraph', children: [text('quoted')] }] },
      { type: 'paragraph', children: [text('not quoted')] }
    ])
  })
})

describe('parseMarkdown: lists', () => {
  it('parses a simple bullet list', () => {
    const blocks = parseMarkdown('- one\n- two\n- three')
    expect(blocks).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          { children: [text('one')], nested: [] },
          { children: [text('two')], nested: [] },
          { children: [text('three')], nested: [] }
        ]
      }
    ])
  })

  it('parses * and + as bullets too', () => {
    expect(parseMarkdown('* a\n* b')).toEqual(parseMarkdown('- a\n- b'))
    expect(parseMarkdown('+ a\n+ b')).toEqual(parseMarkdown('- a\n- b'))
  })

  it('parses a numbered list honouring its start value', () => {
    const blocks = parseMarkdown('3. first\n4. second') as [Extract<BlockNode, { type: 'list' }>]
    expect(blocks[0].type).toBe('list')
    expect(blocks[0].ordered).toBe(true)
    expect(blocks[0].start).toBe(3)
    expect(blocks[0].items.map((item) => item.children)).toEqual([[text('first')], [text('second')]])
  })

  it('accepts ")" as an ordered marker', () => {
    const blocks = parseMarkdown('1) one\n2) two')
    expect(blocks).toEqual(parseMarkdown('1. one\n2. two'))
  })

  it('nests a bullet sub-list under its parent item', () => {
    const blocks = parseMarkdown('- parent\n  - child one\n  - child two') as [Extract<BlockNode, { type: 'list' }>]
    expect(blocks[0].items).toHaveLength(1)
    const parent = blocks[0].items[0]
    if (!parent) throw new Error('expected a parent list item')
    expect(parent.children).toEqual([text('parent')])
    expect(parent.nested).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        items: [
          { children: [text('child one')], nested: [] },
          { children: [text('child two')], nested: [] }
        ]
      }
    ])
  })

  it('ends the list at a dedented, non-blank, non-list line', () => {
    const blocks = parseMarkdown('- item\nplain paragraph')
    expect(blocks).toEqual([
      { type: 'list', ordered: false, start: 1, items: [{ children: [text('item')], nested: [] }] },
      { type: 'paragraph', children: [text('plain paragraph')] }
    ])
  })

  it('does not treat "-word" (no space) as a list item', () => {
    expect(parseMarkdown('-word')).toEqual([{ type: 'paragraph', children: [text('-word')] }])
  })

  it('a switch from bullet to ordered markers starts a new list', () => {
    const blocks = parseMarkdown('- a\n1. b')
    expect(blocks).toHaveLength(2)
    expect((blocks[0] as Extract<BlockNode, { type: 'list' }>).ordered).toBe(false)
    expect((blocks[1] as Extract<BlockNode, { type: 'list' }>).ordered).toBe(true)
  })
})

describe('parseMarkdown: pipe tables', () => {
  it('parses a header, alignment row, and body rows', () => {
    const blocks = parseMarkdown('| A | B |\n| :-- | --: |\n| 1 | 2 |')
    expect(blocks).toEqual([
      {
        type: 'table',
        header: [[text('A')], [text('B')]],
        align: ['left', 'right'],
        rows: [[[text('1')], [text('2')]]]
      }
    ])
  })

  it('accepts a table without leading/trailing pipes', () => {
    const blocks = parseMarkdown('A | B\n--- | ---\n1 | 2')
    expect(blocks).toEqual([
      { type: 'table', header: [[text('A')], [text('B')]], align: [null, null], rows: [[[text('1')], [text('2')]]] }
    ])
  })

  it('stops the table at the first non-row line', () => {
    const blocks = parseMarkdown('A | B\n--- | ---\n1 | 2\n\nafter')
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [text('after')] })
  })
})

describe('parseMarkdown: inline emphasis and code', () => {
  it('parses bold with ** and __', () => {
    expect(parseMarkdown('**bold**')).toEqual([{ type: 'paragraph', children: [{ type: 'bold', children: [text('bold')] }] }])
    expect(parseMarkdown('__bold__')).toEqual([{ type: 'paragraph', children: [{ type: 'bold', children: [text('bold')] }] }])
  })

  it('parses italic with * and _', () => {
    expect(parseMarkdown('*italic*')).toEqual([{ type: 'paragraph', children: [{ type: 'italic', children: [text('italic')] }] }])
    expect(parseMarkdown('_italic_')).toEqual([{ type: 'paragraph', children: [{ type: 'italic', children: [text('italic')] }] }])
  })

  it('parses inline code without interpreting markdown inside it', () => {
    const blocks = parseMarkdown('`**not bold**`')
    expect(blocks).toEqual([{ type: 'paragraph', children: [{ type: 'code', value: '**not bold**' }] }])
  })

  it('parses text around and between emphasis runs', () => {
    const blocks = parseMarkdown('a **b** c *d* e')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [
          text('a '),
          { type: 'bold', children: [text('b')] },
          text(' c '),
          { type: 'italic', children: [text('d')] },
          text(' e')
        ]
      }
    ])
  })

  it('leaves an unterminated ** literal rather than throwing (streaming-safe)', () => {
    const blocks = parseMarkdown('this is **unfinished')
    expect(blocks).toEqual([{ type: 'paragraph', children: [text('this is **unfinished')] }])
  })

  it('leaves an unterminated ` literal rather than throwing', () => {
    const blocks = parseMarkdown('this is `unfinished')
    expect(blocks).toEqual([{ type: 'paragraph', children: [text('this is `unfinished')] }])
  })

  it('leaves an empty ** pair literal rather than emitting an empty bold node', () => {
    expect(parseMarkdown('a **** b')).toEqual([{ type: 'paragraph', children: [text('a **** b')] }])
  })
})

describe('parseMarkdown: links', () => {
  it('parses an http(s) link', () => {
    const blocks = parseMarkdown('[Applyer](https://example.com/jobs)')
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'link', href: 'https://example.com/jobs', children: [text('Applyer')] }] }
    ])
  })

  it('renders a non-http(s) scheme as plain text rather than a link', () => {
    const blocks = parseMarkdown('[danger](file:///etc/passwd)')
    expect(blocks).toEqual([{ type: 'paragraph', children: [text('[danger](file:///etc/passwd)')] }])
  })

  it('renders malformed link syntax as plain text', () => {
    expect(parseMarkdown('[missing paren](https://example.com')).toEqual([
      { type: 'paragraph', children: [text('[missing paren](https://example.com')] }
    ])
    expect(parseMarkdown('[no target]')).toEqual([{ type: 'paragraph', children: [text('[no target]')] }])
  })

  it('parses emphasis inside a link label', () => {
    const blocks = parseMarkdown('[**bold link**](https://example.com)')
    expect(blocks).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'link', href: 'https://example.com', children: [{ type: 'bold', children: [text('bold link')] }] }]
      }
    ])
  })
})

describe('parseMarkdown: degradation and robustness', () => {
  it('never throws on adversarial input', () => {
    const inputs = [
      '',
      '```',
      '**',
      '[',
      '](',
      '> ',
      '- ',
      '1.',
      '|||',
      '#'.repeat(50),
      '`'.repeat(1000),
      '\n\n\n\n',
      'a'.repeat(50000)
    ]
    for (const input of inputs) {
      expect(() => parseMarkdown(input)).not.toThrow()
    }
  })

  it('round-trips plain text with no markdown syntax untouched', () => {
    const plain = 'Just a normal sentence with no special characters at all.'
    expect(parseMarkdown(plain)).toEqual([{ type: 'paragraph', children: [text(plain)] }])
  })
})
