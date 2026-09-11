import { Component, type ErrorInfo, type ReactNode } from 'react'

/**
 * Catches a render-time throw so one broken subtree doesn't take the window
 * with it.
 *
 * React unmounts the whole tree when nothing catches — which in a single-window
 * desktop app means a blank window and no way back short of quitting. A job
 * row with an unexpected shape (a bundle imported from an older build, a
 * column the agent wrote something odd into) should cost the panel it is in,
 * not the session, and never the terminal attached to a live pty.
 *
 * The fallback is a render prop rather than a fixed element: this class holds
 * no translations, since a boundary that needed i18n to render its own error
 * message would be one more thing that can fail while failing. Callers pass a
 * fallback that is already translated.
 */
interface Props {
  children: ReactNode
  fallback: (error: Error, reset: () => void) => ReactNode
  /** Names the subtree in the console line, so a report says *which* panel died. */
  label?: string
}

interface State {
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`Render failed${this.props.label ? ` in ${this.props.label}` : ''}:`, error, info.componentStack)
  }

  /**
   * Clearing the error re-renders the children that just threw. That is worth
   * offering because the common cause is one bad value in data that a refetch
   * or a live update may already have replaced — and if it throws again, the
   * fallback simply comes back.
   */
  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    if (this.state.error) {
      return this.props.fallback(this.state.error, this.reset)
    }
    return this.props.children
  }
}
