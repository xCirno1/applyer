import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Dropdown from '../../components/ui/Dropdown'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { EMPTY_PROFILE, useProfileStore } from '../../state/profileStore'
import type { ProfileFields } from '@shared/types/profile'
import AdditionalInformationEditor from '../../components/profile/AdditionalInformationEditor'
import EditableProfileField from '../../components/profile/EditableProfileField'

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
  const [editingField, setEditingField] = useState<keyof ProfileFields | null>(null)
  const [saveVersion, setSaveVersion] = useState(0)
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
      setEditingField(null)
      setSaveVersion((version) => version + 1)
      toast.success(t('profile.saved', { ns: 'common' }))
    } else {
      toast.error(result.error ? errorMessage(result.error) : t('profile.saveFailed', { ns: 'common' }))
    }
  }

  const remotePreferenceLabels: Record<ProfileFields['remotePreference'], string> = {
    no_preference: t('profile.remoteNoPreference', { ns: 'common' }),
    remote: t('profile.remoteRemote', { ns: 'common' }),
    hybrid: t('profile.remoteHybrid', { ns: 'common' }),
    onsite: t('profile.remoteOnsite', { ns: 'common' })
  }
  const inputClass = 'h-7 border border-border bg-canvas-soft px-2 text-[13px] text-text outline-none focus:border-accent'
  const edit = (field: keyof ProfileFields): void => setEditingField(field)

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <EditableProfileField label={t('profile.fullName', { ns: 'common' })} value={fields.fullName} editing={editingField === 'fullName'} onEdit={() => edit('fullName')}>
          <input autoFocus value={fields.fullName} onChange={(event) => set('fullName', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField label={t('profile.email', { ns: 'common' })} value={fields.email} editing={editingField === 'email'} onEdit={() => edit('email')}>
          <input autoFocus type="email" value={fields.email} onChange={(event) => set('email', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField label={t('profile.phone', { ns: 'common' })} value={fields.phone} editing={editingField === 'phone'} onEdit={() => edit('phone')}>
          <input autoFocus value={fields.phone} onChange={(event) => set('phone', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField label={t('profile.location', { ns: 'common' })} value={fields.location} editing={editingField === 'location'} onEdit={() => edit('location')}>
          <input autoFocus value={fields.location} onChange={(event) => set('location', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.linkedinUrl', { ns: 'common' })}
          value={fields.linkedinUrl}
          editing={editingField === 'linkedinUrl'}
          onEdit={() => edit('linkedinUrl')}
        >
          <input autoFocus value={fields.linkedinUrl} onChange={(event) => set('linkedinUrl', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField label={t('profile.githubUrl', { ns: 'common' })} value={fields.githubUrl} editing={editingField === 'githubUrl'} onEdit={() => edit('githubUrl')}>
          <input autoFocus value={fields.githubUrl} onChange={(event) => set('githubUrl', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.portfolioUrl', { ns: 'common' })}
          value={fields.portfolioUrl}
          editing={editingField === 'portfolioUrl'}
          onEdit={() => edit('portfolioUrl')}
        >
          <input autoFocus value={fields.portfolioUrl} onChange={(event) => set('portfolioUrl', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.workAuthorization', { ns: 'common' })}
          value={fields.workAuthorization}
          editing={editingField === 'workAuthorization'}
          onEdit={() => edit('workAuthorization')}
        >
          <input autoFocus value={fields.workAuthorization} onChange={(event) => set('workAuthorization', event.target.value)} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.desiredRoles', { ns: 'common' })}
          hint={t('profile.commaSeparated', { ns: 'common' })}
          value={fields.desiredRoles.join(', ')}
          editing={editingField === 'desiredRoles'}
          onEdit={() => edit('desiredRoles')}
        >
          <input autoFocus value={fields.desiredRoles.join(', ')} onChange={(event) => set('desiredRoles', splitList(event.target.value))} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.desiredLocations', { ns: 'common' })}
          hint={t('profile.commaSeparated', { ns: 'common' })}
          value={fields.desiredLocations.join(', ')}
          editing={editingField === 'desiredLocations'}
          onEdit={() => edit('desiredLocations')}
        >
          <input autoFocus value={fields.desiredLocations.join(', ')} onChange={(event) => set('desiredLocations', splitList(event.target.value))} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.remotePreference', { ns: 'common' })}
          value={remotePreferenceLabels[fields.remotePreference]}
          editing={editingField === 'remotePreference'}
          onEdit={() => edit('remotePreference')}
        >
          <Dropdown
            value={fields.remotePreference}
            onChange={(value) => set('remotePreference', value as ProfileFields['remotePreference'])}
            options={[
            { value: 'no_preference', label: t('profile.remoteNoPreference', { ns: 'common' }) },
            { value: 'remote', label: t('profile.remoteRemote', { ns: 'common' }) },
            { value: 'hybrid', label: t('profile.remoteHybrid', { ns: 'common' }) },
            { value: 'onsite', label: t('profile.remoteOnsite', { ns: 'common' }) }
            ]}
          />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.yearsExperience', { ns: 'common' })}
          value={fields.yearsExperience?.toString() ?? ''}
          editing={editingField === 'yearsExperience'}
          onEdit={() => edit('yearsExperience')}
        >
          <input autoFocus type="number" min={0} value={fields.yearsExperience ?? ''} onChange={(event) => set('yearsExperience', event.target.value === '' ? null : Number(event.target.value))} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.salaryMin', { ns: 'common' })}
          value={fields.salaryMin?.toString() ?? ''}
          editing={editingField === 'salaryMin'}
          onEdit={() => edit('salaryMin')}
        >
          <input autoFocus type="number" min={0} value={fields.salaryMin ?? ''} onChange={(event) => set('salaryMin', event.target.value === '' ? null : Number(event.target.value))} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.salaryMax', { ns: 'common' })}
          value={fields.salaryMax?.toString() ?? ''}
          editing={editingField === 'salaryMax'}
          onEdit={() => edit('salaryMax')}
        >
          <input autoFocus type="number" min={0} value={fields.salaryMax ?? ''} onChange={(event) => set('salaryMax', event.target.value === '' ? null : Number(event.target.value))} className={inputClass} />
        </EditableProfileField>
        <EditableProfileField
          label={t('profile.salaryCurrency', { ns: 'common' })}
          value={fields.salaryCurrency}
          editing={editingField === 'salaryCurrency'}
          onEdit={() => edit('salaryCurrency')}
        >
          <input autoFocus value={fields.salaryCurrency} onChange={(event) => set('salaryCurrency', event.target.value)} className={inputClass} />
        </EditableProfileField>
      </div>

      <EditableProfileField
        label={t('profile.skills', { ns: 'common' })}
        hint={t('profile.commaSeparated', { ns: 'common' })}
        value={fields.skills.join(', ')}
        editing={editingField === 'skills'}
        onEdit={() => edit('skills')}
      >
        <input autoFocus value={fields.skills.join(', ')} onChange={(event) => set('skills', splitList(event.target.value))} className={inputClass} />
      </EditableProfileField>

      <EditableProfileField label={t('profile.summary', { ns: 'common' })} value={fields.summary} editing={editingField === 'summary'} onEdit={() => edit('summary')}>
        <textarea
          autoFocus
          value={fields.summary}
          onChange={(event) => set('summary', event.target.value)}
          rows={3}
          className="border border-border bg-canvas-soft px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
        />
      </EditableProfileField>

      <AdditionalInformationEditor
        key={saveVersion}
        value={fields.additionalInformation}
        onChange={(additionalInformation) => set('additionalInformation', additionalInformation)}
      />

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} loading={saving}>
          {t('actions.save', { ns: 'common' })}
        </Button>
      </div>
    </div>
  )
}
