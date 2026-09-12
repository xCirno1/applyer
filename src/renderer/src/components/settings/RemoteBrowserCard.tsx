import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '../ui/Button'
import Checkbox from '../ui/Checkbox'
import Collapsible from '../ui/Collapsible'
import ConfirmDialog from '../ui/ConfirmDialog'
import CopyBlock from '../ui/CopyBlock'
import Skeleton from '../ui/Skeleton'
import TextField from '../ui/TextField'
import WarningPanel from '../ui/WarningPanel'
import { useToast } from '../ui/useToast'
import { useErrorMessage } from '../../i18n/formatError'
import { callIpc } from '../../lib/ipcCall'
import {
  checkRemoteBrowserEndpoint,
  DEFAULT_REMOTE_BROWSER_SETTINGS,
  type RemoteBrowserEndpointProblem,
  type RemoteBrowserProbe,
  type RemoteBrowserSettings
} from '@shared/types/remoteBrowser'

/**
 * Settings > Browser's "Attach to a running browser" panel: the switch, the
 * remote-debugging address, and a "Test connection" that attaches and
 * disconnects without opening anything (see `shared/types/remoteBrowser.ts`
 * for what attaching is and what it trades away).
 *
 * The switch saves on its own, behind a confirm dialog when turning on, the
 * same shape as the local-addresses permission next to it: it widens what the
 * app can reach, so it gets the same "are you sure" treatment. The address is
 * a text field and saves on an explicit button instead, since saving on every
 * keystroke would persist half-typed URLs and re-validate the field mid-word.
 * Turning the switch on saves the address currently in the field along with
 * it, so a user who edits the address and then flips the switch does not lose
 * the edit; if that address is invalid the switch stays off and the field
 * shows why, rather than storing "enabled" with nowhere to attach to.
 *
 * Collapsed by default, with On/Off in the header: most users never touch
 * this, and the panel is long (address, test, how-to, warning), so it should
 * not push the network-access permission below it off screen. The state lives
 * in this component rather than inside the disclosure so collapsing mid-test
 * or with an unsaved address loses nothing.
 */

/** Chrome's own flag; shown verbatim, so it is not a translation key. */
const CHROME_FLAG = '--remote-debugging-port=9222'

/** Mirrors the main process's announce delay for an agent-driven attach, so both surfaces nudge at the same moment. */
const WAITING_HINT_DELAY_MS = 1500

const PROBLEM_KEYS = {
  empty: 'browser.remoteEndpointEmpty',
  tooLong: 'browser.remoteEndpointTooLong',
  invalidUrl: 'browser.remoteEndpointInvalidUrl',
  unsupportedProtocol: 'browser.remoteEndpointUnsupportedProtocol'
} as const satisfies Record<RemoteBrowserEndpointProblem, string>

type TestOutcome = { kind: 'ok'; probe: RemoteBrowserProbe } | { kind: 'error'; message: string }

export default function RemoteBrowserCard(): ReactElement {
  const [saved, setSaved] = useState<RemoteBrowserSettings | null>(null)
  const [endpointDraft, setEndpointDraft] = useState('')
  const [endpointProblem, setEndpointProblem] = useState<RemoteBrowserEndpointProblem | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [waitingOnBrowser, setWaitingOnBrowser] = useState(false)
  const [testOutcome, setTestOutcome] = useState<TestOutcome | null>(null)
  const [confirmEnable, setConfirmEnable] = useState(false)
  const { t } = useTranslation('settings')
  const toast = useToast()
  const formatError = useErrorMessage()

  useEffect(() => {
    void callIpc('browserSetup.getRemoteBrowser', () => window.api.browserSetup.getRemoteBrowser(), {
      ...DEFAULT_REMOTE_BROWSER_SETTINGS
    }).then((settings) => {
      setSaved(settings)
      setEndpointDraft(settings.endpoint)
    })
  }, [])

  /** Validates the draft, surfacing the problem inline; returns the trimmed endpoint or null. */
  const validEndpoint = (): string | null => {
    const check = checkRemoteBrowserEndpoint(endpointDraft)
    setEndpointProblem(check.ok ? null : check.problem)
    return check.ok ? check.endpoint : null
  }

  const save = async (enabled: boolean, endpointOverride?: string): Promise<void> => {
    const endpoint = endpointOverride ?? validEndpoint()
    if (endpoint === null) return
    if (endpointOverride !== undefined) setEndpointProblem(null)
    setSaving(true)
    const result = await callIpc(
      'browserSetup.setRemoteBrowser',
      () => window.api.browserSetup.setRemoteBrowser({ enabled, endpoint }),
      { ok: false }
    )
    setSaving(false)
    setConfirmEnable(false)
    if (result.ok) {
      setSaved({ enabled, endpoint })
      setEndpointDraft(endpoint)
      toast.success(t('browser.remoteSaved'))
    } else {
      toast.error(result.error ? formatError(result.error) : t('browser.remoteSaveFailed'))
    }
  }

  const handleEnabledChange = (enabled: boolean): void => {
    if (!enabled) {
      // Turning the privileged mode off must never be blocked by a half-edited endpoint:
      // fall back to the endpoint that was last saved, which is known to be valid.
      const draft = checkRemoteBrowserEndpoint(endpointDraft)
      void save(false, draft.ok ? draft.endpoint : (saved?.endpoint ?? DEFAULT_REMOTE_BROWSER_SETTINGS.endpoint))
      return
    }
    // Validate before asking, so the dialog is never confirming a save that cannot happen.
    if (validEndpoint() !== null) setConfirmEnable(true)
  }

  const test = async (): Promise<void> => {
    const endpoint = validEndpoint()
    if (endpoint === null) return
    setTesting(true)
    setTestOutcome(null)
    // A browser that isn't listening fails at once; one that is still pending after this
    // long is almost certainly holding the handshake open behind its own permission prompt.
    const waitingTimer = window.setTimeout(() => setWaitingOnBrowser(true), WAITING_HINT_DELAY_MS)
    const result = await callIpc(
      'browserSetup.testRemoteBrowser',
      () => window.api.browserSetup.testRemoteBrowser(endpoint),
      { ok: false as const, error: { code: 'unexpected' as const } }
    )
    window.clearTimeout(waitingTimer)
    setWaitingOnBrowser(false)
    setTesting(false)
    if (result.ok) {
      setTestOutcome({ kind: 'ok', probe: result.probe })
    } else {
      const message = formatError(result.error)
      setTestOutcome({ kind: 'error', message })
      toast.error(message)
    }
  }

  const busy = saving || testing
  const endpointDirty = saved !== null && endpointDraft.trim() !== saved.endpoint

  // The dialog sits outside the disclosure so collapsing the panel can never unmount an
  // in-flight confirmation; everything else unmounts freely, since the state lives up here.
  return (
    <>
      <Collapsible
        label={t('browser.remoteTitle')}
        summary={saved === null ? undefined : saved.enabled ? t('browser.remoteStateOn') : t('browser.remoteStateOff')}
      >
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-text-muted">{t('browser.remoteIntro')}</p>

          {saved === null ? (
            <>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-7 w-full" />
            </>
          ) : (
            <>
              <Checkbox
                id="remote-browser-enabled"
                label={t('browser.remoteEnable')}
                hint={t('browser.remoteEnableHint')}
                checked={saved.enabled}
                onChange={handleEnabledChange}
                disabled={busy}
              />

              <TextField
                id="remote-browser-endpoint"
                label={t('browser.remoteEndpoint')}
                hint={t('browser.remoteEndpointHint')}
                error={endpointProblem ? t(PROBLEM_KEYS[endpointProblem]) : undefined}
                value={endpointDraft}
                onChange={(event) => {
                  setEndpointDraft(event.target.value)
                  setEndpointProblem(null)
                  setTestOutcome(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && endpointDirty && !busy) void save(saved.enabled)
                }}
                placeholder={DEFAULT_REMOTE_BROWSER_SETTINGS.endpoint}
                spellCheck={false}
                autoComplete="off"
                disabled={busy}
              />

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="secondary" loading={testing} disabled={busy} onClick={() => void test()}>
                  {t('browser.remoteTest')}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  loading={saving}
                  disabled={busy || !endpointDirty}
                  onClick={() => void save(saved.enabled)}
                >
                  {t('browser.remoteSave')}
                </Button>
                {waitingOnBrowser && (
                  <span className="text-[12px] text-text-muted" role="status">
                    {t('browser.remoteTestWaiting')}
                  </span>
                )}
                {testOutcome?.kind === 'ok' && (
                  <span
                    className={`text-[12px] ${testOutcome.probe.hasDefaultContext ? 'text-success' : 'text-warning'}`}
                    role="status"
                  >
                    {testOutcome.probe.hasDefaultContext
                      ? t('browser.remoteTestOk', {
                          version: testOutcome.probe.browserVersion,
                          count: testOutcome.probe.pageCount
                        })
                      : t('browser.remoteTestNoProfile', {
                          version: testOutcome.probe.browserVersion
                        })}
                    {testOutcome.probe.profileDir && (
                      <>
                        {' '}
                        <span className="text-text-muted">
                          {t('browser.remoteTestVia', {
                            profileDir: testOutcome.probe.profileDir
                          })}
                        </span>
                      </>
                    )}
                  </span>
                )}
                {testOutcome?.kind === 'error' && (
                  <span className="text-[12px] text-danger" role="alert">
                    {testOutcome.message}
                  </span>
                )}
              </div>
            </>
          )}

          <p className="text-[12px] text-text-muted">{t('browser.remoteHowTo')}</p>
          <CopyBlock text={CHROME_FLAG} />

          <WarningPanel title={t('browser.remoteScopeTitle')}>
            <p className="text-[12px] text-text-muted">{t('browser.remoteScopeWarning')}</p>
          </WarningPanel>
        </div>
      </Collapsible>

      <ConfirmDialog
        open={confirmEnable}
        title={t('browser.remoteConfirmTitle')}
        message={t('browser.remoteConfirmMessage')}
        confirmLabel={t('browser.remoteConfirm')}
        danger
        loading={saving}
        onConfirm={() => void save(true)}
        onCancel={() => setConfirmEnable(false)}
      />
    </>
  )
}
