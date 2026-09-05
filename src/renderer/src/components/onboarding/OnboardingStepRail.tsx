import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import logo from '../../assets/logo.png'
import { useOnboardingNav } from './OnboardingNavContext'
import {
  RAIL_STEPS,
  isStepReachable,
  railStepState,
  type OnboardingStepId,
  type RailStepState
} from '../../pages/Onboarding/onboardingSteps'

/**
 * The onboarding flow's left rail: brand mark, the list of steps with their
 * done/active/upcoming state, and the "nothing leaves this computer" line
 * that is worth having in view the whole way through rather than only on
 * the storage step.
 *
 * Steps already reached are buttons, so the rail doubles as navigation and
 * a five-step flow stops being a five-click one: fixing a typo on step two
 * from step five costs one click each way instead of three. Steps not yet
 * reached stay inert text rather than becoming disabled buttons, since a
 * step you have not got to is not something that was taken away from you.
 * What counts as reached is `maxReachableStep`'s call, not this component's.
 *
 * Same visual language as `navigation/IconRail`: a full-height opaque band
 * with a hard seam against the content, and the active row marked by a left
 * accent border rather than a filled pill or a badge. Hidden below `sm` (the
 * content column shows the same position as "step N of M" in its header),
 * since a 200px rail beside a form is the first thing a narrow window
 * should give up.
 *
 * The brand row carries no bottom seam of its own: the rail runs the full
 * height of the window now, so a seam there would cut across the middle of
 * the taller header band beside it rather than lining up with anything.
 */
export default function OnboardingStepRail({ active }: { active: OnboardingStepId }): ReactElement {
  const { t } = useTranslation('onboarding')
  const nav = useOnboardingNav()

  return (
    <nav
      aria-label={t('rail.label')}
      className="hidden w-[200px] shrink-0 flex-col border-r border-border bg-canvas-soft sm:flex"
    >
      <div className="flex h-nav shrink-0 items-center gap-2 px-3">
        <img src={logo} alt="" className="h-4 w-4 shrink-0" draggable={false} />
        <span className="text-[12px] font-medium text-text">{t('rail.brand')}</span>
      </div>

      <ol className="flex flex-col py-1">
        {RAIL_STEPS.map((step, index) => (
          <RailRow
            key={step}
            index={index}
            label={t(`rail.steps.${step}`)}
            state={railStepState(step, active, nav?.furthest ?? active)}
            // The active row is reachable by definition but has nowhere to
            // go, so it stays plain text rather than a button that does
            // nothing when pressed.
            onNavigate={
              nav && step !== active && isStepReachable(step, nav.maxReachable)
                ? () => nav.navigate(step)
                : null
            }
          />
        ))}
      </ol>

      <p className="mt-auto border-t border-border-soft px-3 py-2 text-[11px] text-text-faint">
        {t('rail.privacyNote')}
      </p>
    </nav>
  )
}

const ROW_CLASSES: Record<RailStepState, string> = {
  done: 'border-l-transparent text-text-muted',
  active: 'border-l-accent bg-canvas text-text',
  upcoming: 'border-l-transparent text-text-faint'
}

const ROW_BASE = 'flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left text-[12px]'

function RailRow({
  index,
  label,
  state,
  onNavigate
}: {
  index: number
  label: string
  state: RailStepState
  onNavigate: (() => void) | null
}): ReactElement {
  const content = (
    <>
      <span className="flex w-3 shrink-0 justify-center text-[10px] font-medium tabular-nums">
        {state === 'done' ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-success">
            <path d="M4 12.5l5.5 5.5L20 6.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          index + 1
        )}
      </span>
      <span className="truncate">{label}</span>
    </>
  )

  return (
    <li aria-current={state === 'active' ? 'step' : undefined}>
      {onNavigate ? (
        <button
          type="button"
          onClick={onNavigate}
          className={`${ROW_BASE} ${ROW_CLASSES[state]} cursor-pointer outline-none hover:bg-canvas-raised hover:text-text focus-visible:border-l-accent`}
        >
          {content}
        </button>
      ) : (
        <div className={`${ROW_BASE} ${ROW_CLASSES[state]}`}>{content}</div>
      )}
    </li>
  )
}
