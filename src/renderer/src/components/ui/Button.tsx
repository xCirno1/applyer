import type { ButtonHTMLAttributes, ReactElement } from 'react'
import Spinner from './Spinner'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90 border border-transparent',
  secondary: 'bg-canvas-soft text-text border border-border hover:bg-canvas-raised',
  danger: 'bg-danger text-danger-fg hover:opacity-90 border border-transparent',
  ghost: 'bg-transparent text-text-muted hover:text-text border border-transparent hover:bg-canvas-soft'
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-6 px-2 text-[12px] gap-1.5',
  md: 'h-7 px-3 text-[13px] gap-1.5'
}

export default function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  ...rest
}: ButtonProps): ReactElement {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        disabled || loading ? '' : 'cursor-pointer'
      } ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]}`}
    >
      {loading && <Spinner className="h-3 w-3" />}
      {children}
    </button>
  )
}
