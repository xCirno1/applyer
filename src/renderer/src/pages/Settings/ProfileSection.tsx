import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import TextField from '../../components/ui/TextField'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { EMPTY_PROFILE, useProfileStore } from '../../state/profileStore'
import type { ProfileFields } from '@shared/types/profile'

/**
 * Field-by-field rather than a stringify comparison: both sides are built by
 * spreading the same shape, but key order is not something this needs to
 * depend on.
 */
function sameProfile(a: ProfileFields, b: ProfileFields): boolean {
  return (Object.keys(EMPTY_PROFILE) as (keyof ProfileFields)[]).every((key) => {
    const left = a[key]
    const right = b[key]
    if (Array.isArray(left) && Array.isArray(right)) {
      return left.length === right.length && left.every((value, i) => value === right[i])
    }
    return left === right
  })
}

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

export default function ProfileSection(): ReactElement {
  const profile = useProfileStore((s) => s.profile)
  const loaded = useProfileStore((s) => s.loaded)
  const fetchProfile = useProfileStore((s) => s.fetch)
  const save = useProfileStore((s) => s.save)
  const { t } = useTranslation(['settings', 'common'])
  const toast = useToast()
  const errorMessage = useErrorMessage()

  const [fields, setFields] = useState<ProfileFields>(profile)
  const [saving, setSaving] = useState(false)
  // The store value the draft was last taken from; anything else in `fields`
  // is an unsaved local edit.
  const syncedRef = useRef<ProfileFields>(profile)

  useEffect(() => {
    if (!loaded) fetchProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Syncs the local editable draft once the async profile fetch resolves —
    // intentional, not a derived-state smell (the draft then diverges from
    // the store as the user types, until Save writes it back). A write from
    // outside this form (the agent, via the store's profile:changed
    // subscription) can now land mid-edit too, so the draft
    // is only replaced when it holds no unsaved edits — or when the incoming
    // profile is already what the draft says, which is this form's own save
    // coming back through the store.
    if (sameProfile(fields, syncedRef.current) || sameProfile(profile, fields)) {
      syncedRef.current = profile
      setFields(profile)
      return
    }
    if (!sameProfile(profile, syncedRef.current)) {
      toast.info(t('profile.changedElsewhere', { ns: 'common' }))
      syncedRef.current = profile
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const handleSave = async (): Promise<void> => {
    if (!fields.fullName.trim() || !fields.email.trim()) {
      toast.error(t('profile.nameEmailRequired', { ns: 'common' }))
      return
    }
    setSaving(true)
    const result = await save(fields)
    setSaving(false)
    if (result.ok) {
      toast.success(t('profile.saved', { ns: 'common' }))
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('profile.saveFailed', { ns: 'common' }))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <TextField label={t('profile.fullName', { ns: 'common' })} value={fields.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <TextField label={t('profile.email', { ns: 'common' })} type="email" value={fields.email} onChange={(e) => set('email', e.target.value)} />
        <TextField label={t('profile.phone', { ns: 'common' })} value={fields.phone} onChange={(e) => set('phone', e.target.value)} />
        <TextField label={t('profile.location', { ns: 'common' })} value={fields.location} onChange={(e) => set('location', e.target.value)} />
        <TextField
          label={t('profile.linkedinUrl', { ns: 'common' })}
          value={fields.linkedinUrl}
          onChange={(e) => set('linkedinUrl', e.target.value)}
        />
        <TextField label={t('profile.githubUrl', { ns: 'common' })} value={fields.githubUrl} onChange={(e) => set('githubUrl', e.target.value)} />
        <TextField
          label={t('profile.portfolioUrl', { ns: 'common' })}
          value={fields.portfolioUrl}
          onChange={(e) => set('portfolioUrl', e.target.value)}
        />
        <TextField
          label={t('profile.workAuthorization', { ns: 'common' })}
          value={fields.workAuthorization}
          onChange={(e) => set('workAuthorization', e.target.value)}
        />
        <TextField
          label={t('profile.desiredRoles', { ns: 'common' })}
          hint={t('profile.commaSeparated', { ns: 'common' })}
          value={fields.desiredRoles.join(', ')}
          onChange={(e) => set('desiredRoles', splitList(e.target.value))}
        />
        <TextField
          label={t('profile.desiredLocations', { ns: 'common' })}
          hint={t('profile.commaSeparated', { ns: 'common' })}
          value={fields.desiredLocations.join(', ')}
          onChange={(e) => set('desiredLocations', splitList(e.target.value))}
        />
        <Select
          label={t('profile.remotePreference', { ns: 'common' })}
          value={fields.remotePreference}
          onChange={(v) => set('remotePreference', v as ProfileFields['remotePreference'])}
          options={[
            { value: 'no_preference', label: t('profile.remoteNoPreference', { ns: 'common' }) },
            { value: 'remote', label: t('profile.remoteRemote', { ns: 'common' }) },
            { value: 'hybrid', label: t('profile.remoteHybrid', { ns: 'common' }) },
            { value: 'onsite', label: t('profile.remoteOnsite', { ns: 'common' }) }
          ]}
        />
        <TextField
          label={t('profile.yearsExperience', { ns: 'common' })}
          type="number"
          min={0}
          value={fields.yearsExperience ?? ''}
          onChange={(e) => set('yearsExperience', e.target.value === '' ? null : Number(e.target.value))}
        />
        <TextField
          label={t('profile.salaryMin', { ns: 'common' })}
          type="number"
          min={0}
          value={fields.salaryMin ?? ''}
          onChange={(e) => set('salaryMin', e.target.value === '' ? null : Number(e.target.value))}
        />
        <TextField
          label={t('profile.salaryMax', { ns: 'common' })}
          type="number"
          min={0}
          value={fields.salaryMax ?? ''}
          onChange={(e) => set('salaryMax', e.target.value === '' ? null : Number(e.target.value))}
        />
        <TextField
          label={t('profile.salaryCurrency', { ns: 'common' })}
          value={fields.salaryCurrency}
          onChange={(e) => set('salaryCurrency', e.target.value)}
        />
      </div>

      <TextField
        label={t('profile.skills', { ns: 'common' })}
        hint={t('profile.commaSeparated', { ns: 'common' })}
        value={fields.skills.join(', ')}
        onChange={(e) => set('skills', splitList(e.target.value))}
      />

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-text-muted">{t('profile.summary', { ns: 'common' })}</span>
        <textarea
          value={fields.summary}
          onChange={(e) => set('summary', e.target.value)}
          rows={3}
          className="border border-border bg-canvas-soft px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
        />
      </label>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} loading={saving}>
          {t('actions.save', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}
