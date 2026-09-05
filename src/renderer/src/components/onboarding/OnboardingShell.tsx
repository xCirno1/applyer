import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import OnboardingStepRail from './OnboardingStepRail'
import { setToastInset } from '../ui/toastInset'
import { railProgress, railProgressFraction, type OnboardingStepId } from '../../pages/Onboarding/onboardingSteps'

interface OnboardingShellProps {
  step: OnboardingStepId
  title: string
  subtitle?: string
  /** The back button, or nothing on the first step, which has nowhere to go back to. */
  back?: ReactNode
  /** This step's forward actions. Always right-aligned, however many there are. */
  actions: ReactNode
  children: ReactNode
}

/**
 * The frame every onboarding step renders into. It fills the window rather
 * than floating a panel in the middle of it: this is the whole app until
 * setup is finished, not something opened on top of the app, and a dialog
 * sitting on an empty background implies there is something behind it to go
 * back to.
 *
 * The chrome is the same shape the workspace uses once onboarding is over
 * (an opaque rail against a hard seam, a header band, a footer band), so the
 * first screen already looks like the app it leads into.
 *
 * Only the body scrolls, so the primary action stays in the same place from
 * the first screen to the last and the profile step's field list can never
 * push Continue off-screen. Its content is width-capped and centered instead
 * of running the full width of the window, which on a wide display would
 * stretch a text field to 900px and a sentence past comfortable reading
 * length.
 *
 * The rail stays up on the payoff screen (`ready`) even though the rail
 * doesn't list it: five checked rows is the better ending, and removing the
 * rail there would slide the centered content column sideways on the last
 * transition, which reads as a glitch rather than as a finish. What does go
 * away is the counter, since "step 6 of 5" is not a thing.
 */
export default function OnboardingShell({
  step,
  title,
  subtitle,
  back,
  actions,
  children
}: OnboardingShellProps): ReactElement {
  const { t } = useTranslation('onboarding')
  const { position, total } = railProgress(step)
  const onRail = position > 0
  const footerRef = useRef<HTMLElement>(null)

  // The footer runs the full width of the window, so its primary action sits
  // in the corner the toast stack owns. Measured rather than assumed: the
  // band's height follows its buttons, and a toast that covers Continue
  // blocks the click as well as the view (see `ui/toastInset.ts`). Observed
  // rather than measured once, since a step's footer can grow (a wrapped
  // gate hint) after the first paint.
  useLayoutEffect(() => {
    const footer = footerRef.current
    if (!footer) return
    const report = (): void => setToastInset(footer.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(footer)
    return () => {
      observer.disconnect()
      setToastInset(null)
    }
  }, [])

  return (
    <div className="flex h-full bg-canvas">
      <OnboardingStepRail active={step} />

      <div key={step} className="animate-step-in flex min-w-0 flex-1 flex-col">
        <header className="shrink-0 border-b border-border px-6 py-4">
          <div className="mx-auto w-full max-w-2xl">
            {onRail && (
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-text-faint">
                  {t('progress.counter', { position, total })}
                </span>
                <div className="h-px flex-1 bg-border-soft" aria-hidden="true">
                  <div
                    className="h-px bg-accent"
                    style={{ width: `${Math.round(railProgressFraction(step) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <h1 className="text-[16px] font-medium text-text">{title}</h1>
            {subtitle && <p className="mt-1 text-[13px] text-text-muted">{subtitle}</p>}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
          {/* my-auto (not justify-center on the scroll container) so a step
              taller than the window stays top-anchored and fully scrollable
              instead of being clipped equally at both edges. Centering an
              overflowing flex child via justify-content leaves the portion
              before the start edge unreachable by scroll in some browsers. */}
          <div className="mx-auto my-auto w-full max-w-2xl">{children}</div>
        </div>

        <footer ref={footerRef} className="shrink-0 border-t border-border bg-canvas-soft px-6 py-3">
          {/* Back left, everything else right, decided here rather than by
              each step: a step that passed a lone primary button got it
              rendered in the Back position, which is both the wrong place
              for it and the one place a person has learned not to press. */}
          <div className="mx-auto flex w-full max-w-2xl items-center gap-2">
            {back}
            <div className="ml-auto flex items-center gap-2">{actions}</div>
          </div>
        </footer>
      </div>
    </div>
  )
}
