import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../../components/ui/Button'
import CopyBlock from '../../components/ui/CopyBlock'
import Skeleton from '../../components/ui/Skeleton'
import OnboardingShell from '../../components/onboarding/OnboardingShell'
import { CLI_LABELS } from '../../components/settings/mcpCliLabels'
import { useProfileStore } from '../../state/profileStore'
import { useToast } from '../../components/ui/useToast'
import { chooseFirstPrompt } from './firstPrompt'
import type { StorageMode } from '@shared/types/profile'

interface Setup {
  storageMode: StorageMode | null
  connectedClis: string[]
}

/** The first name alone, for the greeting. Long enough to be a name, short enough to be a heading. */
function firstName(fullName: string): string | null {
  const first = fullName.trim().split(/\s+/)[0] ?? ''
  return first === '' || first.length > 24 ? null : first
}

/**
 * The screen the flow ends on: what got set up, and one sentence worth
 * saying to the agent first. It exists because finishing onboarding
 * otherwise drops the user into an empty board with a terminal and no
 * indication that the two are connected.
 *
 * This is also where onboarding is marked complete, not on the agent step,
 * which the user may well leave half-configured and come back to.
 */
export default function ReadyStep({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }): ReactElement {
  const { t } = useTranslation('onboarding')
  const toast = useToast()
  const profile = useProfileStore((s) => s.profile)
  const documents = useProfileStore((s) => s.documents)
  const [setup, setSetup] = useState<Setup | null>(null)
  const [loading, setLoading] = useState(true)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Both reads are decoration on a screen whose only job is to finish:
    // either failing costs a summary line, never the Finish button, so they
    // settle independently rather than sharing one rejection.
    void Promise.allSettled([
      window.api.onboarding.getStatus(),
      window.api.onboarding.detectMcpConfigs()
    ]).then(([status, detections]) => {
      if (cancelled) return
      if (status.status === 'rejected') {
        console.error(`Could not read the onboarding status: ${String(status.reason)}`)
      }
      if (detections.status === 'rejected') {
        console.error(`Could not detect installed agent CLIs: ${String(detections.reason)}`)
      }
      const list = detections.status === 'fulfilled' && Array.isArray(detections.value) ? detections.value : []
      setSetup({
        storageMode: status.status === 'fulfilled' ? status.value.storageMode : null,
        connectedClis: list
          .filter((d) => d.configuredScopes.length > 0)
          .map((d) => CLI_LABELS[d.cli] ?? d.cli)
      })
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  const resume = documents.find((d) => d.kind === 'resume')
  const coverLetter = documents.find((d) => d.kind === 'cover_letter')
  const profileComplete = profile.fullName.trim() !== '' && profile.email.trim() !== ''
  const name = firstName(profile.fullName)

  const choice = chooseFirstPrompt({
    profileComplete,
    hasResume: resume !== undefined,
    desiredRoles: profile.desiredRoles
  })
  const suggestedPrompt =
    choice.kind === 'roleSearch'
      ? t('ready.prompts.roleSearch', { role: choice.role })
      : choice.kind === 'fromResume'
        ? t('ready.prompts.fromResume')
        : t('ready.prompts.genericSearch')

  const handleFinish = async (): Promise<void> => {
    setFinishing(true)
    try {
      const result = await window.api.onboarding.complete()
      if (!result.ok) {
        setFinishing(false)
        toast.error(t('ready.finishFailed'))
        return
      }
    } catch (err) {
      // Without this the button would spin forever on a failed IPC call and
      // the user would have no way out of a flow they have finished.
      console.error(`Could not mark onboarding complete: ${String(err)}`)
      setFinishing(false)
      toast.error(t('ready.finishFailed'))
      return
    }
    onFinish()
  }

  return (
    <OnboardingShell
      step="ready"
      title={name ? t('ready.titleNamed', { name }) : t('ready.title')}
      subtitle={t('ready.intro')}
      back={
        <Button variant="ghost" onClick={onBack} disabled={finishing}>
          {t('nav.back')}
        </Button>
      }
      actions={
        <Button variant="primary" onClick={handleFinish} loading={finishing}>
          {t('ready.finish')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <SectionLabel>{t('ready.summaryLabel')}</SectionLabel>
          <ul className="flex flex-col border border-border-soft">
            <SummaryRow
              done={profileComplete}
              label={t('ready.summary.profile')}
              detail={profileComplete ? profile.fullName : t('ready.summary.profilePending')}
            />
            <SummaryRow
              done={resume !== undefined}
              label={t('ready.summary.resume')}
              detail={resume?.originalFilename ?? t('ready.summary.resumeMissing')}
            />
            <SummaryRow
              done={coverLetter !== undefined}
              label={t('ready.summary.coverLetter')}
              detail={coverLetter?.originalFilename ?? t('ready.summary.coverLetterMissing')}
            />
            <SummaryRow
              done={loading ? null : setup?.storageMode !== null && setup?.storageMode !== undefined}
              label={t('ready.summary.storage')}
              detail={
                loading ? null : setup?.storageMode
                  ? t(setup.storageMode === 'encrypted' ? 'storage.encrypted' : 'storage.plaintext')
                  : t('ready.summary.unknown')
              }
            />
            <SummaryRow
              done={loading ? null : (setup?.connectedClis.length ?? 0) > 0}
              label={t('ready.summary.agent')}
              detail={
                loading ? null : setup && setup.connectedClis.length > 0
                  ? setup.connectedClis.join(', ')
                  : t('ready.summary.agentPending')
              }
            />
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <SectionLabel>{t('ready.firstPromptLabel')}</SectionLabel>
          <CopyBlock text={suggestedPrompt} variant="wrap" caption={t('ready.firstPromptCaption')} />
        </section>
      </div>
    </OnboardingShell>
  )
}

function SectionLabel({ children }: { children: string }): ReactElement {
  return (
    <div className="flex items-center gap-2">
      <h2 className="text-[10px] font-medium uppercase tracking-wide text-text-faint">{children}</h2>
      <div className="h-px flex-1 bg-border-soft" />
    </div>
  )
}

/**
 * `null` on either field means "still being read": the detail shows a
 * placeholder rather than an empty column, and the marker gutter stays
 * blank rather than showing the dash, which would claim the row is not set
 * up before anything has actually been checked.
 */
function SummaryRow({
  done,
  label,
  detail
}: {
  done: boolean | null
  label: string
  detail: string | null
}): ReactElement {
  return (
    <li className="flex items-center gap-2 border-b border-border-soft px-2.5 py-1.5 text-[12px] last:border-b-0">
      <span className="flex w-3 shrink-0 justify-center" aria-hidden="true">
        {done === null ? null : done ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="text-success">
            <path d="M4 12.5l5.5 5.5L20 6.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <span className="h-px w-2 bg-text-faint" />
        )}
      </span>
      <span className="shrink-0 text-text">{label}</span>
      <span className="ml-auto min-w-0 truncate text-text-muted" title={detail ?? undefined}>
        {detail === null ? <Skeleton className="h-3 w-24" /> : detail}
      </span>
    </li>
  )
}
