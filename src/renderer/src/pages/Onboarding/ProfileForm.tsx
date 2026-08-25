import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import TextField from '../../components/ui/TextField'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { useProfileStore } from '../../state/profileStore'
import type { ProfileFields } from '@shared/types/profile'

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

export default function ProfileForm({ onNext, onBack }: { onNext: () => void; onBack: () => void }): ReactElement {
  const profile = useProfileStore((s) => s.profile)
  const save = useProfileStore((s) => s.save)
  const { t } = useTranslation(['onboarding', 'common'])
  const toast = useToast()
  const errorMessage = useErrorMessage()

  const [fields, setFields] = useState<ProfileFields>(profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const handleNext = async (): Promise<void> => {
    if (!fields.fullName.trim() || !fields.email.trim()) {
      setError(t('profile.nameEmailRequired', { ns: 'common' }))
      return
    }
    setError(null)
    setSaving(true)
    const result = await save(fields)
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error ? errorMessage(result.error) : t('profile.saveFailed', { ns: 'common' }))
      return
    }
    onNext()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">{t('profileForm.title')}</h1>
        <p className="mt-1 text-[13px] text-text-muted">{t('profileForm.intro')}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField label={t('profile.fullName', { ns: 'common' })} value={fields.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <TextField
          label={t('profile.email', { ns: 'common' })}
          type="email"
          value={fields.email}
          onChange={(e) => set('email', e.target.value)}
        />
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
          hint='e.g. "US citizen", "requires sponsorship"'
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

      <TextField label={t('profile.skills', { ns: 'common' })} hint={t('profile.commaSeparated', { ns: 'common' })} value={fields.skills.join(', ')} onChange={(e) => set('skills', splitList(e.target.value))} />

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-text-muted">{t('profile.summary', { ns: 'common' })}</span>
        <textarea
          value={fields.summary}
          onChange={(e) => set('summary', e.target.value)}
          rows={3}
          className="border border-border bg-canvas-soft px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
        />
      </label>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onBack}>
          {t('nav.back')}
        </Button>
        <Button variant="primary" onClick={handleNext} loading={saving}>
          {t('nav.next')}
        </Button>
      </div>
    </div>
  )
}
