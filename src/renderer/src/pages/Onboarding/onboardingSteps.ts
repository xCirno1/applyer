/*
 * The onboarding step order, plus the arithmetic the rail and the progress
 * bar read off it. Plain module (no React, no DOM) for the same reason as
 * `workspace/workspaceLayout.ts`: the ordering rules are the part worth
 * testing, and a component that just renders them shouldn't have to be
 * mounted to exercise them.
 *
 * Storage mode MUST stay ahead of profile/documents: `saveProfile` and
 * `addDocument` read the current storage_mode setting at write time and
 * don't retroactively re-encrypt anything, so asking afterwards would
 * silently write everything as plaintext regardless of the choice.
 */

export const ONBOARDING_STEPS = ['welcome', 'storage', 'profile', 'documents', 'agent', 'ready'] as const

export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number]

/**
 * The steps the rail lists and the progress counter counts. `ready` is the
 * payoff screen the flow ends on rather than a step worked through, so it
 * is deliberately not one of them: a counter reading "step 6 of 6" on a
 * screen with nothing left to do would be counting a celebration as a
 * chore.
 */
export const RAIL_STEPS = ['welcome', 'storage', 'profile', 'documents', 'agent'] as const

export type RailStepId = (typeof RAIL_STEPS)[number]

export type RailStepState = 'done' | 'active' | 'upcoming'

export function isOnboardingStep(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

/** Position in the full flow, or -1 for an id that isn't a step at all. */
export function stepIndex(step: OnboardingStepId): number {
  return ONBOARDING_STEPS.indexOf(step)
}

/**
 * Both directions clamp at the ends and fall back to the first step for an
 * unrecognized id, so a bad value navigates somewhere real instead of
 * rendering nothing. That can only come from a bug on this side (the id is
 * never persisted or received over IPC), which is exactly why it is worth a
 * log line rather than a silent recovery.
 */
export function nextStep(step: OnboardingStepId): OnboardingStepId {
  return stepAtOffset(step, 1)
}

export function previousStep(step: OnboardingStepId): OnboardingStepId {
  return stepAtOffset(step, -1)
}

function stepAtOffset(step: OnboardingStepId, offset: number): OnboardingStepId {
  const index = stepIndex(step)
  if (index === -1) {
    console.warn(`Onboarding: unknown step "${String(step)}", falling back to the first step.`)
    return ONBOARDING_STEPS[0]
  }
  const target = Math.min(Math.max(index + offset, 0), ONBOARDING_STEPS.length - 1)
  return ONBOARDING_STEPS[target]!
}

/**
 * 1-based position of `step` among the rail steps, and how many there are.
 * A step that isn't on the rail (`ready`, or a bad id) reports position 0,
 * which reads as "past the end" to the progress bar and as "no active row"
 * to the rail.
 */
export function railProgress(step: OnboardingStepId): { position: number; total: number } {
  const index = (RAIL_STEPS as readonly string[]).indexOf(step)
  return { position: index + 1, total: RAIL_STEPS.length }
}

/** Fraction of the flow completed, 0..1, for the progress bar's width. */
export function railProgressFraction(step: OnboardingStepId): number {
  const { position, total } = railProgress(step)
  if (position === 0) return stepIndex(step) === -1 ? 0 : 1
  return position / total
}

/**
 * `furthest` is the deepest step reached so far, which is what "done" is
 * judged against rather than the current step: someone who walked to the
 * agent step and then jumped back to their profile has still finished the
 * documents step, and a check mark that un-ticks itself when you look back
 * at earlier work would be lying about what is left to do.
 *
 * Defaults to `active`, which is the same thing on the way forward.
 */
export function railStepState(
  step: RailStepId,
  active: OnboardingStepId,
  furthest: OnboardingStepId = active
): RailStepState {
  if (step === active) return 'active'
  const furthestIndex = stepIndex(furthest)
  if (furthestIndex === -1) return 'upcoming'
  return stepIndex(step) < furthestIndex ? 'done' : 'upcoming'
}

/**
 * Conditions a step can sit behind, checked against live state rather than
 * against how far the user once got. Only one exists: the documents step
 * requires a resume, and every step after it is downstream of that.
 */
export interface StepGates {
  hasResume: boolean
}

/**
 * The deepest step the rail may jump to. Normally that is simply how far
 * the user has already been, since reaching a step means its gate was
 * satisfied at the time. It is re-derived from the gates rather than
 * remembered because that can stop being true: walk to the agent step,
 * come back, delete the resume, and the rail would otherwise still offer a
 * one-click route past a requirement the flow enforces everywhere else.
 */
export function maxReachableStep(furthest: OnboardingStepId, gates: StepGates): OnboardingStepId {
  const furthestIndex = stepIndex(furthest)
  if (furthestIndex === -1) {
    console.warn(`Onboarding: unknown furthest step "${String(furthest)}", allowing only the first step.`)
    return ONBOARDING_STEPS[0]
  }
  if (gates.hasResume) return furthest
  const gatedAt = stepIndex('documents')
  return furthestIndex <= gatedAt ? furthest : ONBOARDING_STEPS[gatedAt]!
}

/** Whether `target` may be navigated to, given the deepest currently-allowed step. */
export function isStepReachable(target: OnboardingStepId, maxReachable: OnboardingStepId): boolean {
  const targetIndex = stepIndex(target)
  const maxIndex = stepIndex(maxReachable)
  if (targetIndex === -1 || maxIndex === -1) return false
  return targetIndex <= maxIndex
}

/** The deeper of two steps, for advancing the high-water mark without going backwards. */
export function deeperStep(a: OnboardingStepId, b: OnboardingStepId): OnboardingStepId {
  return stepIndex(b) > stepIndex(a) ? b : a
}
