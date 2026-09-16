import { useMemo, type Key, type ReactElement, type ReactNode } from 'react'
import { parseMarkdown, type BlockNode, type InlineNode, type ListItem } from './markdown'

/**
 * Renders `markdown.ts`'s AST to React elements - no `dangerouslySetInnerHTML`
 * anywhere, since the source is a model's reply, not markup this app wrote.
 * `content` is re-parsed on every render behind a `useMemo` keyed on the
 * string itself: cheap while a message streams (a few KB, re-parsed once per
 * delta), and free once a message is done, since `AssistantMessage` passes
 * the same completed string on every subsequent render and `React.memo`
 * there usually skips the render entirely anyway.
 */
export default function MarkdownView({ content }: { content: string }): ReactElement {
  const blocks = useMemo(() => parseMarkdown(content), [content])
  return <div className="flex flex-col gap-1.5 text-[13px] leading-snug text-text">{renderBlocks(blocks)}</div>
}

function renderBlocks(blocks: BlockNode[]): ReactNode[] {
  return blocks.map((block, index) => <BlockView key={blockKey(block, index)} block={block} />)
}

function blockKey(block: BlockNode, index: number): Key {
  return `${block.type}-${index}`
}

function BlockView({ block }: { block: BlockNode }): ReactElement {
  switch (block.type) {
    case 'paragraph':
      return <p className="whitespace-pre-wrap">{renderInline(block.children)}</p>
    case 'heading': {
      const classes: Record<1 | 2 | 3, string> = {
        1: 'text-[16px] font-semibold text-text',
        2: 'text-[14px] font-semibold text-text',
        3: 'text-[13px] font-semibold text-text'
      }
      const Tag = (`h${block.level}` as unknown) as 'h1' | 'h2' | 'h3'
      return <Tag className={classes[block.level]}>{renderInline(block.children)}</Tag>
    }
    case 'list':
      return <ListView block={block} />
    case 'code':
      return (
        <pre className="overflow-x-auto border border-border-soft bg-canvas-inset p-2 text-[12px] text-text">
          <code>{block.value}</code>
        </pre>
      )
    case 'blockquote':
      return (
        <blockquote className="flex flex-col gap-1.5 border-l-2 border-border-soft pl-2 text-text-muted">
          {renderBlocks(block.children)}
        </blockquote>
      )
    case 'hr':
      return <hr className="border-border-soft" />
    case 'table':
      return <TableView block={block} />
    default:
      return null as never
  }
}

function ListView({ block }: { block: Extract<BlockNode, { type: 'list' }> }): ReactElement {
  const Tag = block.ordered ? 'ol' : 'ul'
  return (
    <Tag start={block.ordered ? block.start : undefined} className={block.ordered ? 'list-decimal pl-5' : 'list-disc pl-5'}>
      {block.items.map((item, index) => (
        <ListItemView key={index} item={item} />
      ))}
    </Tag>
  )
}

function ListItemView({ item }: { item: ListItem }): ReactElement {
  return (
    <li>
      {renderInline(item.children)}
      {item.nested.length > 0 && <div className="mt-1 flex flex-col gap-1.5">{renderBlocks(item.nested)}</div>}
    </li>
  )
}

function TableView({ block }: { block: Extract<BlockNode, { type: 'table' }> }): ReactElement {
  const alignClass = (align: 'left' | 'center' | 'right' | null): string =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            {block.header.map((cell, index) => (
              <th
                key={index}
                className={`border-b border-border-soft px-2 py-1 font-medium text-text ${alignClass(block.align[index] ?? null)}`}
              >
                {renderInline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={`border-b border-border-soft px-2 py-1 text-text ${alignClass(block.align[cellIndex] ?? null)}`}
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderInline(nodes: InlineNode[]): ReactNode[] {
  return nodes.map((node, index) => <InlineView key={index} node={node} />)
}

function InlineView({ node }: { node: InlineNode }): ReactElement | string | null {
  switch (node.type) {
    case 'text':
      return node.value
    case 'break':
      return <br />
    case 'bold':
      return <strong className="font-semibold text-text">{renderInline(node.children)}</strong>
    case 'italic':
      return <em>{renderInline(node.children)}</em>
    case 'code':
      return <code className="border border-border-soft bg-canvas-inset px-1 text-[12px]">{node.value}</code>
    case 'link':
      // No onClick/openExternal plumbing needed: main's setWindowOpenHandler
      // already routes any window.open (which a target="_blank" anchor
      // triggers) through the OS browser after validating the scheme - see
      // src/main/window.ts.
      return (
        <a href={node.href} target="_blank" rel="noreferrer" className="text-accent underline hover:opacity-80">
          {renderInline(node.children)}
        </a>
      )
    default:
      return null
  }
}
