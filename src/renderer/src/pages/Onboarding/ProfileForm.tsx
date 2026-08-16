import { useState, type ReactElement } from 'react'
import TextField from '../../components/ui/TextField'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ui/useToast'
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
  const toast = useToast()

  const [fields, setFields] = useState<ProfileFields>(profile)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const handleNext = async (): Promise<void> => {
    if (!fields.fullName.trim() || !fields.email.trim()) {
      setError('Full name and email are required.')
      return
    }
    setError(null)
    setSaving(true)
    const result = await save(fields)
    setSaving(false)
    if (!result.ok) {
      toast.error(result.error ?? 'Failed to save profile.')
      return
    }
    onNext()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[16px] font-medium text-text">Your profile</h1>
        <p className="mt-1 text-[13px] text-text-muted">
          The agent uses this to judge job matches and fill application forms.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField label="Full name" value={fields.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <TextField
          label="Email"
          type="email"
          value={fields.email}
          onChange={(e) => set('email', e.target.value)}
        />
        <TextField label="Phone" value={fields.phone} onChange={(e) => set('phone', e.target.value)} />
        <TextField label="Location" value={fields.location} onChange={(e) => set('location', e.target.value)} />
        <TextField
          label="LinkedIn URL"
          value={fields.linkedinUrl}
          onChange={(e) => set('linkedinUrl', e.target.value)}
        />
        <TextField label="GitHub URL" value={fields.githubUrl} onChange={(e) => set('githubUrl', e.target.value)} />
        <TextField
          label="Portfolio URL"
          value={fields.portfolioUrl}
          onChange={(e) => set('portfolioUrl', e.target.value)}
        />
        <TextField
          label="Work authorization"
          hint='e.g. "US citizen", "requires sponsorship"'
          value={fields.workAuthorization}
          onChange={(e) => set('workAuthorization', e.target.value)}
        />
        <TextField
          label="Desired roles"
          hint="comma-separated"
          value={fields.desiredRoles.join(', ')}
          onChange={(e) => set('desiredRoles', splitList(e.target.value))}
        />
        <TextField
          label="Desired locations"
          hint="comma-separated"
          value={fields.desiredLocations.join(', ')}
          onChange={(e) => set('desiredLocations', splitList(e.target.value))}
        />
        <Select
          label="Remote preference"
          value={fields.remotePreference}
          onChange={(e) => set('remotePreference', e.target.value as ProfileFields['remotePreference'])}
          options={[
            { value: 'no_preference', label: 'No preference' },
            { value: 'remote', label: 'Remote' },
            { value: 'hybrid', label: 'Hybrid' },
            { value: 'onsite', label: 'Onsite' }
          ]}
        />
        <TextField
          label="Years of experience"
          type="number"
          min={0}
          value={fields.yearsExperience ?? ''}
          onChange={(e) => set('yearsExperience', e.target.value === '' ? null : Number(e.target.value))}
        />
        <TextField
          label="Salary min"
          type="number"
          min={0}
          value={fields.salaryMin ?? ''}
          onChange={(e) => set('salaryMin', e.target.value === '' ? null : Number(e.target.value))}
        />
        <TextField
          label="Salary max"
          type="number"
          min={0}
          value={fields.salaryMax ?? ''}
          onChange={(e) => set('salaryMax', e.target.value === '' ? null : Number(e.target.value))}
        />
        <TextField
          label="Salary currency"
          value={fields.salaryCurrency}
          onChange={(e) => set('salaryCurrency', e.target.value)}
        />
      </div>

      <TextField label="Skills" hint="comma-separated" value={fields.skills.join(', ')} onChange={(e) => set('skills', splitList(e.target.value))} />

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-text-muted">Summary</span>
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
          Back
        </Button>
        <Button variant="primary" onClick={handleNext} loading={saving}>
          Next
        </Button>
      </div>
    </div>
  )
}
