import { useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import TextField from '../../components/ui/TextField'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import Callout from '../../components/ui/Callout'
import OnboardingShell from '../../components/onboarding/OnboardingShell'
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

/**
 * Whether the draft differs from what is already stored. Both objects are
 * the same `ProfileFields` shape built from the same literal, so their key
 * order matches and a stringify comparison is exact rather than merely
 * likely. Only used to decide whether skipping still needs to write:
 * someone who typed half a profile and then chose to finish it later should
 * not lose the half they typed.
 */
function hasEdits(draft: ProfileFields, stored: ProfileFields): boolean {
  return JSON.stringify(draft) !== JSON.stringify(stored)
}

function FieldGroup({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-2">
      {/* A label plus a trailing rule rather than a bordered box per group:
          the seam separates the groups without adding a second frame inside
          the panel that already has one. */}
      <div className="flex items-center gap-2">
        <h2 className="text-[10px] font-medium uppercase tracking-wide text-text-faint">{title}</h2>
        <div className="h-px flex-1 bg-border-soft" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}

/**
 * The draft is owned by `OnboardingFlow`, not by this form: the rail can
 * leave this step mid-sentence, and state held here would be discarded on
 * the way out. Nothing is written until Continue or "I'll fill this later".
 */
export default function ProfileForm({
  fields,
  onFieldsChange,
  onNext,
  onSkip,
  onBack
}: {
  fields: ProfileFields
  onFieldsChange: (fields: ProfileFields) => void
  onNext: () => void
  onSkip: () => void
  onBack: () => void
}): ReactElement {
  const profile = useProfileStore((s) => s.profile)
  const save = useProfileStore((s) => s.save)
  const { t } = useTranslation(['onboarding', 'common'])
  const toast = useToast()
  const errorMessage = useErrorMessage()

  const [saving, setSaving] = useState(false)
  const [skipping, setSkipping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void =>
    onFieldsChange({ ...fields, [key]: value })

  const busy = saving || skipping

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

  /**
   * Skipping is not "discard": whatever was typed is still written (the
   * name/email requirement is a requirement of finishing this step, not of
   * storing a partial profile), so coming back to it later starts where the
   * user left off rather than blank.
   */
  const handleSkip = async (): Promise<void> => {
    setError(null)
    if (hasEdits(fields, profile)) {
      setSkipping(true)
      const result = await save(fields)
      setSkipping(false)
      if (!result.ok) {
        toast.error(result.error ? errorMessage(result.error) : t('profile.saveFailed', { ns: 'common' }))
        return
      }
    }
    toast.info(t('profileForm.skippedToast'))
    onSkip()
  }

  return (
    <OnboardingShell
      step="profile"
      title={t('profileForm.title')}
      subtitle={t('profileForm.intro')}
      back={
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          {t('nav.back')}
        </Button>
      }
      actions={
        <>
          <Button variant="secondary" onClick={handleSkip} loading={skipping} disabled={saving}>
            {t('profileForm.fillLater')}
          </Button>
          <Button variant="primary" onClick={handleNext} loading={saving} disabled={skipping}>
            {t('nav.next')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Callout title={t('profileForm.resumeTipTitle')}>{t('profileForm.resumeTipBody')}</Callout>

        <FieldGroup title={t('profileForm.groupContact')}>
          <TextField
            label={t('profile.fullName', { ns: 'common' })}
            value={fields.fullName}
            onChange={(e) => set('fullName', e.target.value)}
          />
          <TextField
            label={t('profile.email', { ns: 'common' })}
            type="email"
            value={fields.email}
            onChange={(e) => set('email', e.target.value)}
          />
          <TextField
            label={t('profile.phone', { ns: 'common' })}
            value={fields.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
          <TextField
            label={t('profile.location', { ns: 'common' })}
            value={fields.location}
            onChange={(e) => set('location', e.target.value)}
          />
        </FieldGroup>

        <FieldGroup title={t('profileForm.groupLinks')}>
          <TextField
            label={t('profile.linkedinUrl', { ns: 'common' })}
            value={fields.linkedinUrl}
            onChange={(e) => set('linkedinUrl', e.target.value)}
          />
          <TextField
            label={t('profile.githubUrl', { ns: 'common' })}
            value={fields.githubUrl}
            onChange={(e) => set('githubUrl', e.target.value)}
          />
          <TextField
            label={t('profile.portfolioUrl', { ns: 'common' })}
            value={fields.portfolioUrl}
            onChange={(e) => set('portfolioUrl', e.target.value)}
          />
          <TextField
            label={t('profile.workAuthorization', { ns: 'common' })}
            hint={t('profileForm.workAuthorizationHint')}
            value={fields.workAuthorization}
            onChange={(e) => set('workAuthorization', e.target.value)}
          />
        </FieldGroup>

        <FieldGroup title={t('profileForm.groupLooking')}>
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
            label={t('profile.salaryCurrency', { ns: 'common' })}
            value={fields.salaryCurrency}
            onChange={(e) => set('salaryCurrency', e.target.value)}
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
        </FieldGroup>

        <FieldGroup title={t('profileForm.groupAbout')}>
          <TextField
            label={t('profile.yearsExperience', { ns: 'common' })}
            type="number"
            min={0}
            value={fields.yearsExperience ?? ''}
            onChange={(e) => set('yearsExperience', e.target.value === '' ? null : Number(e.target.value))}
          />
          <TextField
            label={t('profile.skills', { ns: 'common' })}
            hint={t('profile.commaSeparated', { ns: 'common' })}
            value={fields.skills.join(', ')}
            onChange={(e) => set('skills', splitList(e.target.value))}
          />
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className="text-[12px] font-medium text-text-muted">
              {t('profile.summary', { ns: 'common' })}
            </span>
            <textarea
              value={fields.summary}
              onChange={(e) => set('summary', e.target.value)}
              rows={3}
              className="border border-border bg-canvas-soft px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
            />
          </label>
        </FieldGroup>

        {error && <p className="text-[12px] text-danger">{error}</p>}
      </div>
    </OnboardingShell>
  )
}
