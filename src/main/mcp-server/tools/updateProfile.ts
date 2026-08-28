import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { z } from 'zod'
import { getProfile, saveProfile } from '../../db/repositories/profileRepository'
import { isOnboardingCompleted } from '../../db/repositories/settingsRepository'
import { logActivity } from '../../db/repositories/activityLogRepository'
import { broadcastProfileChanged } from '../../ipc/jobsBroadcast'
import { jsonResult, textError } from '../toolResult'
import { EMPTY_PROFILE, type ProfileFields } from '@shared/types/profile'
import type { updateProfileShape } from '../schemas'

type Args = { [K in keyof typeof updateProfileShape]: z.infer<(typeof updateProfileShape)[K]> }

const LIST_FIELDS = ['desiredRoles', 'desiredLocations', 'skills'] as const

/** Fields the user must be able to rely on: an agent may fill them, never wipe them. */
const PROTECTED_FIELDS = ['fullName', 'email'] as const

/**
 * Agents routinely repeat an item across a resume's sections ("React" under
 * both Skills and Experience), so a list arrives with duplicates and stray
 * blanks far more often than a hand-typed one does. Normalizing here keeps
 * that out of the stored profile — and out of the comma-joined text fields
 * the Settings form renders it into.
 */
function normalizeList(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (!trimmed) continue
    const key = trimmed.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(trimmed)
  }
  return result
}

function isEqual(a: ProfileFields[keyof ProfileFields], b: ProfileFields[keyof ProfileFields]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => item === b[i])
  }
  return a === b
}

/**
 * Partial update: only the keys the caller actually sent are considered, so
 * an omitted field keeps its stored value rather than being reset to the
 * `EMPTY_PROFILE` default this merges onto when no profile row exists yet.
 */
function mergeUpdates(current: ProfileFields, args: Args): { next: ProfileFields; changed: string[] } {
  const next: ProfileFields = { ...current }
  const changed: string[] = []

  for (const key of Object.keys(EMPTY_PROFILE) as (keyof ProfileFields)[]) {
    const incoming = args[key as keyof Args]
    if (incoming === undefined) continue

    const value = (LIST_FIELDS as readonly string[]).includes(key)
      ? normalizeList(incoming as string[])
      : (incoming as ProfileFields[keyof ProfileFields])

    if (isEqual(value, current[key])) continue
    // Assigning through a computed key rather than narrowing each field
    // individually: the schema already constrains every value to its own
    // field's type, so per-key narrowing would buy nothing.
    Object.assign(next, { [key]: value })
    changed.push(key)
  }

  return { next, changed }
}

export async function updateProfileTool(args: Args): Promise<CallToolResult> {
  if (!isOnboardingCompleted()) {
    return textError(
      'No profile to update — open Applyer and complete onboarding (profile + documents) before editing the profile.'
    )
  }

  if (!args || typeof args !== 'object' || Object.values(args).every((value) => value === undefined)) {
    return textError(
      'No fields given. Pass at least one profile field to update (e.g. skills, summary, yearsExperience). Omitted fields are left untouched.'
    )
  }

  const current = getProfile() ?? EMPTY_PROFILE
  const { next, changed } = mergeUpdates(current, args)

  if (changed.length === 0) {
    return jsonResult({
      status: 'unchanged',
      updatedFields: [],
      message: 'Every field given already had that value. Nothing was written.',
      profile: current
    })
  }

  const cleared = PROTECTED_FIELDS.filter((field) => current[field].trim() !== '' && next[field].trim() === '')
  if (cleared.length > 0) {
    return textError(
      `Refusing to clear ${cleared.join(' and ')} — the app needs ${cleared.length > 1 ? 'those fields' : 'that field'} to fill application forms. Pass a replacement value, or ask the user to clear it in Settings > Profile.`
    )
  }

  // Scoped to calls that actually touch the range. A profile can already
  // hold an inverted one (the Settings form validates the two bounds
  // independently), and that must not block an unrelated partial update like
  // { skills: [...] } — omitted fields are left untouched, bad ones included.
  const touchesSalary = changed.includes('salaryMin') || changed.includes('salaryMax')
  if (touchesSalary && next.salaryMin !== null && next.salaryMax !== null && next.salaryMin > next.salaryMax) {
    return textError(
      `Refusing to save an inverted salary range (min ${next.salaryMin} > max ${next.salaryMax}). Check which figure belongs in which field.`
    )
  }

  try {
    saveProfile(next)
  } catch (err) {
    logActivity('error', 'Agent profile update failed', { error: String(err), fields: changed })
    return textError(`Failed to update profile: ${String(err)}`)
  }

  logActivity('info', `Agent updated profile: ${changed.join(', ')}`, { fields: changed })
  broadcastProfileChanged()

  return jsonResult({
    status: 'updated',
    updatedFields: changed,
    message: `Updated ${changed.length} field${changed.length === 1 ? '' : 's'}. The user can review them in Settings > Profile.`,
    profile: next
  })
}
