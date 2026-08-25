import { useState, type ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import CodeMirror from '@uiw/react-codemirror'
import { css as cssLanguage } from '@codemirror/lang-css'
import Select from '../../components/ui/Select'
import Button from '../../components/ui/Button'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import Collapsible from '../../components/ui/Collapsible'
import Dropdown from '../../components/ui/Dropdown'
import { useTheme } from '../../providers/ThemeContext'
import { useFormatters } from '../../i18n/format'
import { isValidHexColor, MAX_CUSTOM_CSS_LENGTH, type ThemeMode } from '../../theme/theme'
import { TEMPLATE_PLACEHOLDER_ID, THEME_CSS_TEMPLATES } from '../../theme/themeTemplates'

const FALLBACK_ACCENT: Record<'light' | 'dark', string> = {
  dark: '#3c83f6',
  light: '#0b60ea'
}

export default function AppearanceSection(): ReactElement {
  const { t } = useTranslation(['settings', 'common'])
  const format = useFormatters()
  const { state, resolvedScheme, setMode, setAccent, setCustomCss, resetCustomCss, resetAccent } = useTheme()
  const [accentText, setAccentText] = useState(state.accent ?? FALLBACK_ACCENT[resolvedScheme])
  const [accentError, setAccentError] = useState(false)
  const [pendingTemplateId, setPendingTemplateId] = useState<string | null>(null)
  const [confirmResetCssOpen, setConfirmResetCssOpen] = useState(false)

  // Keep the swatch/text field in sync when the accent is reset (or changed
  // from elsewhere), without a setState-in-effect render cascade: this is
  // the "adjust state during render" pattern React recommends for syncing
  // local editable state to an external prop-like value.
  const [prevAccent, setPrevAccent] = useState(state.accent)
  if (state.accent !== prevAccent) {
    setPrevAccent(state.accent)
    setAccentText(state.accent ?? FALLBACK_ACCENT[resolvedScheme])
    setAccentError(false)
  }

  const commitAccentText = (value: string): void => {
    const normalized = value.trim().toLowerCase()
    if (!isValidHexColor(normalized)) {
      setAccentError(true)
      return
    }
    setAccentError(false)
    setAccent(normalized)
  }

  const applyTemplate = (id: string): void => {
    const template = THEME_CSS_TEMPLATES.find((t) => t.id === id)
    if (!template) return
    setCustomCss(template.css)
  }

  const handleTemplateSelect = (id: string): void => {
    if (id === TEMPLATE_PLACEHOLDER_ID) return
    if (state.customCss.trim().length > 0) {
      setPendingTemplateId(id)
      return
    }
    applyTemplate(id)
  }

  const modeOptions = [
    { value: 'system', label: t('appearance.modeSystem') },
    { value: 'light', label: t('appearance.modeLight') },
    { value: 'dark', label: t('appearance.modeDark') }
  ]

  // Template labels stay as authored in themeTemplates.ts — they name
  // specific visual presets, not UI chrome.
  const templateOptions = [
    { value: TEMPLATE_PLACEHOLDER_ID, label: t('appearance.insertTemplate') },
    ...THEME_CSS_TEMPLATES.map((tpl) => ({ value: tpl.id, label: tpl.label }))
  ]

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div>
        <h2 className="text-[13px] font-semibold text-text">{t('appearance.title')}</h2>
        <p className="mt-0.5 text-[12px] text-text-muted">{t('appearance.intro')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <Select
          label={t('appearance.theme')}
          options={modeOptions}
          value={state.mode}
          onChange={(value) => setMode(value as ThemeMode)}
        />
        <p className="text-[11px] text-text-faint">{t('appearance.terminalNote')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-text-muted">{t('appearance.accent')}</span>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label={t('appearance.accentPicker')}
            value={isValidHexColor(accentText) ? accentText : FALLBACK_ACCENT[resolvedScheme]}
            onChange={(e) => {
              setAccentText(e.target.value)
              commitAccentText(e.target.value)
            }}
            className="h-7 w-9 cursor-pointer border border-border bg-canvas-soft p-0.5"
          />
          <input
            type="text"
            aria-label={t('appearance.accentHex')}
            value={accentText}
            onChange={(e) => setAccentText(e.target.value)}
            onBlur={(e) => commitAccentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitAccentText(accentText)
            }}
            placeholder={FALLBACK_ACCENT[resolvedScheme]}
            className={`h-7 w-24 border bg-canvas-soft px-2 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent ${
              accentError ? 'border-danger' : 'border-border'
            }`}
          />
          {accentError && <span className="text-[11px] text-danger">{t('appearance.invalidHex')}</span>}
          {state.accent && (
            <Button size="sm" variant="ghost" onClick={resetAccent}>
              {t('appearance.reset')}
            </Button>
          )}
        </div>
      </div>

      <Collapsible label={t('appearance.advanced')}>
        <div className="flex flex-col gap-2">
          <p className="text-[12px] text-text-muted">
            {/* The app's other markup-inside-a-sentence case (see
                board/CaptchaAlertBanner) — <Trans> keeps it one translatable
                string instead of three reorderable fragments. */}
            <Trans
              t={t}
              i18nKey="appearance.cssIntro"
              values={{ shortcut: t('appearance.cssShortcut') }}
              components={{ 1: <span className="font-mono text-text" /> }}
            />
          </p>

          <Dropdown options={templateOptions} value={TEMPLATE_PLACEHOLDER_ID} onChange={handleTemplateSelect} size="sm" />

          <div className="overflow-hidden border border-border">
            <CodeMirror
              value={state.customCss}
              onChange={(value) => setCustomCss(value.slice(0, MAX_CUSTOM_CSS_LENGTH))}
              theme={resolvedScheme}
              extensions={[cssLanguage()]}
              height="220px"
              basicSetup={{ foldGutter: false }}
              placeholder={'/* e.g. :root { --color-accent: #ff5500; } */'}
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-faint">
              {t('units.characters', {
                ns: 'common',
                used: format.number(state.customCss.length),
                max: format.number(MAX_CUSTOM_CSS_LENGTH)
              })}
            </span>
            <Button size="sm" variant="ghost" disabled={!state.customCss} onClick={() => setConfirmResetCssOpen(true)}>
              {t('appearance.clearCss')}
            </Button>
          </div>
        </div>
      </Collapsible>

      <ConfirmDialog
        open={pendingTemplateId !== null}
        title={t('appearance.replaceTitle')}
        message={t('appearance.replaceMessage')}
        confirmLabel={t('appearance.replaceConfirm')}
        onConfirm={() => {
          if (pendingTemplateId) applyTemplate(pendingTemplateId)
          setPendingTemplateId(null)
        }}
        onCancel={() => setPendingTemplateId(null)}
      />

      <ConfirmDialog
        open={confirmResetCssOpen}
        title={t('appearance.clearTitle')}
        message={t('appearance.clearMessage')}
        confirmLabel={t('appearance.clearConfirm')}
        danger
        onConfirm={() => {
          resetCustomCss()
          setConfirmResetCssOpen(false)
        }}
        onCancel={() => setConfirmResetCssOpen(false)}
      />
    </div>
  )
}
