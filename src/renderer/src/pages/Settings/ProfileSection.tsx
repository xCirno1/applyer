import { useEffect, useState, type ReactElement } from 'react'
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

export default function ProfileSection(): ReactElement {
  const profile = useProfileStore((s) => s.profile)
  const loaded = useProfileStore((s) => s.loaded)
  const fetchProfile = useProfileStore((s) => s.fetch)
  const save = useProfileStore((s) => s.save)
  const toast = useToast()

  const [fields, setFields] = useState<ProfileFields>(profile)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!loaded) fetchProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Syncs the local editable draft once the async profile fetch resolves —
    // intentional, not a derived-state smell (the draft then diverges from
    // the store as the user types, until Save writes it back).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFields(profile)
  }, [profile])

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]): void =>
    setFields((prev) => ({ ...prev, [key]: value }))

  const handleSave = async (): Promise<void> => {
    if (!fields.fullName.trim() || !fields.email.trim()) {
      toast.error('Full name and email are required.')
      return
    }
    setSaving(true)
    const result = await save(fields)
    setSaving(false)
    if (result.ok) {
      toast.success('Profile saved.')
    } else {
      toast.error(result.error ?? 'Failed to save profile.')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Full name" value={fields.fullName} onChange={(e) => set('fullName', e.target.value)} />
        <TextField label="Email" type="email" value={fields.email} onChange={(e) => set('email', e.target.value)} />
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
          onChange={(v) => set('remotePreference', v as ProfileFields['remotePreference'])}
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

      <TextField
        label="Skills"
        hint="comma-separated"
        value={fields.skills.join(', ')}
        onChange={(e) => set('skills', splitList(e.target.value))}
      />

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-text-muted">Summary</span>
        <textarea
          value={fields.summary}
          onChange={(e) => set('summary', e.target.value)}
          rows={3}
          className="border border-border bg-canvas-soft px-2 py-1.5 text-[13px] text-text outline-none focus:border-accent"
        />
      </label>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  )
}
