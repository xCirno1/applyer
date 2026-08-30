import { forwardRef, type ChangeEvent, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '../ui/Tooltip'
import ResizeHandle from '../ui/ResizeHandle'

/**
 * Compact on open by design — widen by dragging the handle rather than
 * defaulting to the full query width. The min is a hard floor, not just a
 * preference: below it the fixed-width controls (toggles, prev/next, close)
 * don't all fit and the close button gets crowded out, so it's set to the
 * narrowest width that still keeps every control on-screen alongside a
 * usable sliver of input.
 */
export const SEARCH_WIDTH_DEFAULT_PX = 350
export const SEARCH_WIDTH_MIN_PX = 260
export const SEARCH_WIDTH_MAX_PX = 520

/**
 * The find-in-terminal panel `TerminalPane` floats over the top-right corner
 * of the xterm surface while a search is active — same reasoning as an
 * editor's inline find widget: it overlays rather than pushing the terminal
 * content down, so opening/closing it never reflows the pty's cols/rows.
 * Fully controlled (mirrors `TerminalTabBar`) — all search state, the
 * `SearchAddon` instance, and the keyboard shortcut that opens it live in
 * `TerminalPane`, since a search addon is bound 1:1 to one xterm instance and
 * `TerminalGroup` keeps every tab's pane mounted at once.
 */
export interface TerminalSearchBarProps {
  width: number
  onWidthChange: (width: number) => void
  query: string
  onQueryChange: (query: string) => void
  caseSensitive: boolean
  wholeWord: boolean
  regex: boolean
  onToggleCaseSensitive: () => void
  onToggleWholeWord: () => void
  onToggleRegex: () => void
  /** -1 once the query is empty or nothing matches. */
  resultIndex: number
  resultCount: number
  onNext: () => void
  onPrevious: () => void
  onClose: () => void
  onInputBlur: () => void
}

const TerminalSearchBar = forwardRef<HTMLInputElement, TerminalSearchBarProps>(function TerminalSearchBar(
  {
    width,
    onWidthChange,
    query,
    onQueryChange,
    caseSensitive,
    wholeWord,
    regex,
    onToggleCaseSensitive,
    onToggleWholeWord,
    onToggleRegex,
    resultIndex,
    resultCount,
    onNext,
    onPrevious,
    onClose,
    onInputBlur
  },
  inputRef
): ReactElement {
  const { t } = useTranslation('workspace')
  const hasQuery = query.length > 0
  const hasNoResults = hasQuery && resultCount === 0

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => onQueryChange(e.target.value)

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) onPrevious()
      else onNext()
    }
  }

  return (
    <div className="absolute top-1.5 right-1.5 z-10 flex h-7">
      {/* Handle sits on the panel's left edge, so growing it means dragging
          left — the panel is the one that comes *after* the handle. */}
      <ResizeHandle
        orientation="vertical"
        value={width}
        min={SEARCH_WIDTH_MIN_PX}
        max={SEARCH_WIDTH_MAX_PX}
        invert
        label={t('terminal.search.resize')}
        onResize={onWidthChange}
      />
      <div
        style={{ width }}
        className="flex h-full items-center gap-1 border border-border bg-canvas-raised px-1.5 shadow-pop"
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onBlur={onInputBlur}
          placeholder={t('terminal.search.placeholder')}
          aria-label={t('terminal.search.placeholder')}
          className="h-5 min-w-6 flex-1 bg-transparent text-[12px] text-text outline-none placeholder:text-text-faint"
        />

        <span
          aria-live="polite"
          className={`shrink-0 text-[11px] tabular-nums ${hasNoResults ? 'text-danger' : 'text-text-faint'}`}
        >
          {hasQuery
            ? hasNoResults
              ? t('terminal.search.noResults')
              : // resultIndex is -1 once the match count passes the addon's
                // highlight threshold — position within the set is unknown then.
                resultIndex === -1
                ? t('terminal.search.manyMatches', { count: resultCount })
                : // The addon numbers matches oldest-first (buffer row order);
                  // this panel navigates newest-first, so the displayed
                  // position is inverted to match — see `runSearch` in
                  // `TerminalPane`.
                  t('terminal.search.resultCount', { index: resultCount - resultIndex, count: resultCount })
            : ''}
        </span>

        <ToggleButton
          label={t('terminal.search.caseSensitive')}
          active={caseSensitive}
          onClick={onToggleCaseSensitive}
        >
          Aa
        </ToggleButton>
        <ToggleButton label={t('terminal.search.wholeWord')} active={wholeWord} onClick={onToggleWholeWord}>
          <WholeWordIcon />
        </ToggleButton>
        <ToggleButton label={t('terminal.search.regex')} active={regex} onClick={onToggleRegex}>
          .*
        </ToggleButton>

        <div className="mx-0.5 h-4 w-px shrink-0 bg-border-soft" />

        <IconButton label={t('terminal.search.previous')} onClick={onPrevious} disabled={!hasQuery}>
          <ChevronIcon direction="up" />
        </IconButton>
        <IconButton label={t('terminal.search.next')} onClick={onNext} disabled={!hasQuery}>
          <ChevronIcon direction="down" />
        </IconButton>
        <IconButton label={t('terminal.search.close')} onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </div>
    </div>
  )
})

export default TerminalSearchBar

function ToggleButton({
  label,
  active,
  onClick,
  children
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactElement | string
}): ReactElement {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={`flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center border text-[10px] font-medium ${
          active ? 'border-accent text-accent' : 'border-transparent text-text-faint hover:text-text'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactElement
}): ReactElement {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`flex h-5 w-5 shrink-0 items-center justify-center text-text-faint hover:text-text disabled:cursor-not-allowed disabled:opacity-40 ${
          disabled ? '' : 'cursor-pointer'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  )
}

function SearchIcon(): ReactElement {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0 text-text-faint">
      <circle cx="5.2" cy="5.2" r="3.7" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 8l2.5 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function CloseIcon(): ReactElement {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function WholeWordIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <text x="7" y="9" textAnchor="middle" fontSize="8" fontWeight="600" fill="currentColor">
        ab
      </text>
      <path d="M1 12h12" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }): ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
      className={direction === 'up' ? 'rotate-180' : ''}
    >
      <path d="M2 3.5L5 7l3-3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
