import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState, type ReactElement } from 'react'

export interface DropdownOption {
  value: string
  label: string
}

interface DropdownProps {
  options: DropdownOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  /** id for the trigger button so a <label htmlFor> can focus it. */
  id?: string
  ariaLabel?: string
  size?: 'sm' | 'md'
  disabled?: boolean
  className?: string
}

const VIEWPORT_MARGIN = 8
const PANEL_GAP = 4
const ESTIMATED_PANEL_HEIGHT = 220

/**
 * Custom listbox replacing native `<select>`: same interaction model (click
 * or ArrowDown to open, arrows + Enter to pick, Escape to close) styled to
 * match the rest of the app's controls instead of the OS chrome a native
 * select renders with.
 *
 * The option panel is `position: fixed`, measured off the trigger — no
 * portal needed, since `fixed` already escapes any ancestor's
 * `overflow-hidden`/`auto` clipping (the same reasoning `Modal` relies on),
 * unlike `Tooltip`'s `absolute` panel which only works because its use
 * sites don't sit inside a clipping ancestor.
 */
export default function Dropdown({
  options,
  value,
  onChange,
  placeholder,
  id,
  ariaLabel,
  size = 'md',
  disabled = false,
  className = ''
}: DropdownProps): ReactElement {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; flip: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find((o) => o.value === value) ?? null

  // Highlight is initialized here, at the moment something actually opens
  // the list, rather than reactively inside the position-measuring effect
  // below — setting state synchronously inside an effect body causes an
  // avoidable extra render.
  const openDropdown = (): void => {
    const idx = options.findIndex((o) => o.value === value)
    setHighlight(idx >= 0 ? idx : 0)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const measure = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const spaceBelow = window.innerHeight - rect.bottom
      const flip = spaceBelow < ESTIMATED_PANEL_HEIGHT && rect.top > ESTIMATED_PANEL_HEIGHT
      setPos({
        top: flip ? rect.top - PANEL_GAP : rect.bottom + PANEL_GAP,
        left: Math.max(Math.min(rect.left, window.innerWidth - rect.width - VIEWPORT_MARGIN), VIEWPORT_MARGIN),
        width: rect.width,
        flip
      })
    }
    measure()

    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (rootRef.current?.contains(target)) return
      if (listRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  const choose = (idx: number): void => {
    const opt = options[idx]
    if (!opt) return
    onChange(opt.value)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (disabled) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) openDropdown()
        else setHighlight((h) => Math.min(h + 1, options.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (open) setHighlight((h) => Math.max(h - 1, 0))
        break
      case 'Home':
        if (open) {
          e.preventDefault()
          setHighlight(0)
        }
        break
      case 'End':
        if (open) {
          e.preventDefault()
          setHighlight(options.length - 1)
        }
        break
      case 'Enter':
      case ' ':
        e.preventDefault()
        if (open) choose(highlight)
        else openDropdown()
        break
      case 'Escape':
        if (open) {
          e.preventDefault()
          setOpen(false)
        }
        break
    }
  }

  const heightClass = size === 'sm' ? 'h-6 text-[12px]' : 'h-7 text-[13px]'

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={`flex w-full items-center justify-between gap-1.5 border px-2 text-left outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${heightClass} ${
          disabled ? '' : 'cursor-pointer'
        } ${
          open ? 'border-accent bg-canvas-soft' : 'border-border bg-canvas-soft hover:border-text-faint'
        } ${!selected ? 'text-text-faint' : 'text-text'}`}
      >
        <span className="truncate">{selected ? selected.label : (placeholder ?? t('dropdown.placeholder'))}</span>
        <ChevronIcon open={open} />
      </button>

      {open && pos && (
        <ul
          ref={listRef}
          role="listbox"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: pos.width,
            transform: pos.flip ? 'translateY(-100%)' : undefined
          }}
          className="z-50 max-h-56 overflow-y-auto border border-border bg-canvas-raised py-1 shadow-pop"
        >
          {options.map((opt, i) => {
            const isSelected = opt.value === value
            return (
              <li key={opt.value} role="option" aria-selected={isSelected} data-index={i}>
                <button
                  type="button"
                  onClick={() => choose(i)}
                  onPointerMove={() => setHighlight(i)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] ${
                    highlight === i ? 'bg-canvas-soft' : ''
                  } ${isSelected ? 'text-text' : 'text-text-muted'}`}
                >
                  <span className="truncate">{opt.label}</span>
                  {isSelected && <CheckIcon />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function ChevronIcon({ open }: { open: boolean }): ReactElement {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 text-text-faint transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function CheckIcon(): ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-accent">
      <path d="M2.5 7.5l3 3 6-7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
