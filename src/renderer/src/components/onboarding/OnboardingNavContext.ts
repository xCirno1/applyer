import { createContext, useContext } from 'react'
import type { OnboardingStepId } from '../../pages/Onboarding/onboardingSteps'

export interface OnboardingNav {
  /** The deepest step reached so far, which is what the rail ticks off as done. */
  furthest: OnboardingStepId
  /** The deepest step the rail may jump to right now (see `maxReachableStep`). */
  maxReachable: OnboardingStepId
  navigate: (step: OnboardingStepId) => void
}

/**
 * Lets the rail jump between steps without every step component having to
 * accept and forward navigation props it does not use itself. A context
 * rather than props for the same reason `ToastContext` is one: the producer
 * (`OnboardingFlow`) and the consumer (`OnboardingStepRail`) are separated
 * by components that have no interest in what passes between them.
 *
 * Split into its own module so `OnboardingFlow.tsx` stays a component-only
 * export, which Fast Refresh requires.
 *
 * `null` is a real state, not just a default to satisfy the type: a rail
 * rendered outside the flow (a test, a future reuse) simply is not
 * clickable, rather than throwing.
 */
export const OnboardingNavContext = createContext<OnboardingNav | null>(null)

export function useOnboardingNav(): OnboardingNav | null {
  return useContext(OnboardingNavContext)
}
