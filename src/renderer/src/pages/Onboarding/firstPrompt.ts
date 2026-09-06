/*
 * Which sentence the payoff screen suggests as the first thing to say to the
 * agent. Plain module (no React) for the same reason as
 * `onboardingSteps.ts`: the branching is the part worth testing, and it
 * needs neither a DOM nor a mounted store.
 *
 * The point of suggesting anything at all is that a fresh install has an
 * agent connected and no idea what to ask it. So the suggestion follows the
 * gap the user actually left: someone who skipped the profile but uploaded
 * a resume is told to have the agent read the resume into the profile,
 * which is the exact promise the profile step made when it offered to let
 * them fill it in later.
 */

export type FirstPromptKind = 'fromResume' | 'roleSearch' | 'genericSearch'

export interface FirstPromptChoice {
  kind: FirstPromptKind
  /** Only set for `roleSearch`: the desired role the sentence names. */
  role?: string
}

export interface FirstPromptInput {
  /** A profile is "complete enough" once it has the fields the form requires. */
  profileComplete: boolean
  hasResume: boolean
  desiredRoles: readonly string[]
}

/**
 * Roles come from a free-text, comma-separated field, so they are neither
 * trusted to be short nor to be single-line: a value carrying a newline
 * would break the suggestion across lines mid-sentence, and an essay-length
 * one would push the rest of it off the block.
 */
const MAX_ROLE_LENGTH = 48

export function usableRole(roles: readonly string[] | undefined): string | null {
  if (!Array.isArray(roles)) {
    if (roles !== undefined) console.warn('Onboarding: desired roles was not a list; ignoring it.')
    return null
  }
  for (const role of roles) {
    if (typeof role !== 'string') continue
    const clean = role.replace(/\s+/g, ' ').trim()
    if (clean === '' || clean.length > MAX_ROLE_LENGTH) continue
    return clean
  }
  return null
}

export function chooseFirstPrompt(input: FirstPromptInput): FirstPromptChoice {
  if (!input.profileComplete && input.hasResume) return { kind: 'fromResume' }

  const role = usableRole(input.desiredRoles)
  return role ? { kind: 'roleSearch', role } : { kind: 'genericSearch' }
}
