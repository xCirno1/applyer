import { describe, it, expect, vi } from 'vitest'
import {
  ONBOARDING_STEPS,
  RAIL_STEPS,
  deeperStep,
  isOnboardingStep,
  isStepReachable,
  maxReachableStep,
  nextStep,
  previousStep,
  railProgress,
  railProgressFraction,
  railStepState,
  stepIndex,
  type OnboardingStepId
} from './onboardingSteps'

/** Every rail step is a real step, in the same relative order. */
describe('step order', () => {
  it('keeps the storage choice ahead of anything that writes data', () => {
    // Not cosmetic: profile/document writes read the storage mode at write
    // time, so asking afterwards would store them under the wrong mode.
    expect(stepIndex('storage')).toBeLessThan(stepIndex('profile'))
    expect(stepIndex('storage')).toBeLessThan(stepIndex('documents'))
  })

  it('lists the rail steps as a prefix of the whole flow', () => {
    expect(ONBOARDING_STEPS.slice(0, RAIL_STEPS.length)).toEqual([...RAIL_STEPS])
  })

  it('ends on the payoff screen, which the rail does not list', () => {
    expect(ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1]).toBe('ready')
    expect(RAIL_STEPS).not.toContain('ready')
  })
})

describe('isOnboardingStep', () => {
  it('accepts every declared step', () => {
    for (const step of ONBOARDING_STEPS) expect(isOnboardingStep(step)).toBe(true)
  })

  it('rejects anything else', () => {
    for (const value of ['', 'Welcome', 'profile ', null, undefined, 3, {}]) {
      expect(isOnboardingStep(value)).toBe(false)
    }
  })
})

describe('navigation', () => {
  it('walks forward and back through the flow', () => {
    expect(nextStep('welcome')).toBe('storage')
    expect(nextStep('documents')).toBe('agent')
    expect(previousStep('agent')).toBe('documents')
    expect(previousStep('storage')).toBe('welcome')
  })

  it('clamps at both ends rather than running off the list', () => {
    expect(previousStep('welcome')).toBe('welcome')
    expect(nextStep('ready')).toBe('ready')
  })

  it('is reversible for every step that has one on each side', () => {
    for (const step of ONBOARDING_STEPS.slice(1, -1)) {
      expect(previousStep(nextStep(step))).toBe(step)
      expect(nextStep(previousStep(step))).toBe(step)
    }
  })

  it('falls back to the first step for an unknown id, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bogus = 'nope' as OnboardingStepId

    expect(nextStep(bogus)).toBe('welcome')
    expect(previousStep(bogus)).toBe('welcome')
    expect(warn).toHaveBeenCalledTimes(2)
  })
})

describe('progress', () => {
  it('numbers the rail steps from one', () => {
    expect(railProgress('welcome')).toEqual({ position: 1, total: RAIL_STEPS.length })
    expect(railProgress('agent')).toEqual({ position: RAIL_STEPS.length, total: RAIL_STEPS.length })
  })

  it('reports no position for a step the rail does not list', () => {
    expect(railProgress('ready').position).toBe(0)
    expect(railProgress('nope' as OnboardingStepId).position).toBe(0)
  })

  it('fills the bar completely once the flow is finished', () => {
    expect(railProgressFraction('welcome')).toBeCloseTo(1 / RAIL_STEPS.length)
    expect(railProgressFraction('ready')).toBe(1)
  })

  it('never reports progress for an id that is not a step at all', () => {
    // A bad id reads as "nothing done yet", not as "finished": an empty bar
    // is a recoverable-looking state, a full one claims work that never ran.
    expect(railProgressFraction('nope' as OnboardingStepId)).toBe(0)
  })

  it('increases monotonically along the rail', () => {
    const fractions = RAIL_STEPS.map(railProgressFraction)
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]!).toBeGreaterThan(fractions[i - 1]!)
    }
  })
})

describe('railStepState', () => {
  it('marks earlier steps done, the current one active, and later ones upcoming', () => {
    expect(railStepState('welcome', 'profile')).toBe('done')
    expect(railStepState('profile', 'profile')).toBe('active')
    expect(railStepState('agent', 'profile')).toBe('upcoming')
  })

  it('marks every step done once the flow reaches the payoff screen', () => {
    for (const step of RAIL_STEPS) expect(railStepState(step, 'ready')).toBe('done')
  })

  it('marks everything upcoming for an unknown active step', () => {
    for (const step of RAIL_STEPS) {
      expect(railStepState(step, 'nope' as OnboardingStepId)).toBe('upcoming')
    }
  })

  it('keeps later steps ticked off after jumping back to an earlier one', () => {
    // The whole point of a navigable rail: going back to fix a typo must
    // not un-tick the work already done past that point.
    expect(railStepState('documents', 'profile', 'agent')).toBe('done')
    expect(railStepState('profile', 'profile', 'agent')).toBe('active')
  })

  it('leaves the deepest step reached unticked until it is passed', () => {
    // Reaching a step is not finishing it, so the row you are standing on
    // (or came back from) is not claimed as done.
    expect(railStepState('agent', 'profile', 'agent')).toBe('upcoming')
  })
})

describe('deeperStep', () => {
  it('keeps the deeper of the two, in either argument order', () => {
    expect(deeperStep('storage', 'agent')).toBe('agent')
    expect(deeperStep('agent', 'storage')).toBe('agent')
    expect(deeperStep('profile', 'profile')).toBe('profile')
  })

  it('never lets going back move the mark backwards', () => {
    let furthest: OnboardingStepId = 'agent'
    for (const step of ['documents', 'profile', 'storage', 'welcome'] as const) {
      furthest = deeperStep(furthest, step)
    }
    expect(furthest).toBe('agent')
  })
})

describe('maxReachableStep', () => {
  it('allows everything already reached once the resume is in place', () => {
    expect(maxReachableStep('agent', { hasResume: true })).toBe('agent')
    expect(maxReachableStep('ready', { hasResume: true })).toBe('ready')
  })

  it('caps at the documents step while no resume exists', () => {
    // Reached the agent step, came back, deleted the resume: the rail must
    // not still offer a one-click route past a requirement the Continue
    // button enforces.
    expect(maxReachableStep('agent', { hasResume: false })).toBe('documents')
    expect(maxReachableStep('ready', { hasResume: false })).toBe('documents')
  })

  it('does not push a shallower position forward to the cap', () => {
    expect(maxReachableStep('storage', { hasResume: false })).toBe('storage')
    expect(maxReachableStep('documents', { hasResume: false })).toBe('documents')
  })

  it('allows only the first step for an unknown mark, and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(maxReachableStep('nope' as OnboardingStepId, { hasResume: true })).toBe('welcome')
    expect(warn).toHaveBeenCalledOnce()
  })
})

describe('isStepReachable', () => {
  it('allows the cap itself and everything before it', () => {
    expect(isStepReachable('welcome', 'documents')).toBe(true)
    expect(isStepReachable('documents', 'documents')).toBe(true)
  })

  it('refuses anything past the cap', () => {
    expect(isStepReachable('agent', 'documents')).toBe(false)
    expect(isStepReachable('ready', 'documents')).toBe(false)
  })

  it('refuses an unknown step on either side rather than guessing', () => {
    expect(isStepReachable('nope' as OnboardingStepId, 'ready')).toBe(false)
    expect(isStepReachable('welcome', 'nope' as OnboardingStepId)).toBe(false)
  })
})
