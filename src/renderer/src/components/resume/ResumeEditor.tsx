import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ResumeContent,
  ResumeEntry,
  ResumeGroup,
  ResumeSection,
  ResumeSectionLayoutKind
} from '@shared/types/resume'
import { RESUME_SECTION_LAYOUT_KINDS } from '@shared/types/resume'
import Button from '../ui/Button'
import Dropdown from '../ui/Dropdown'
import Tag from '../ui/Tag'
import TextArea from '../ui/TextArea'
import TextField from '../ui/TextField'
import Tooltip from '../ui/Tooltip'
import {
  addContact,
  addEntry,
  addGroup,
  addSection,
  canChangeLayout,
  changeSectionLayout,
  linesToList,
  listToLines,
  moveContact,
  moveEntry,
  moveGroup,
  moveSection,
  removeContact,
  removeEntry,
  removeGroup,
  removeSection,
  setListItems,
  updateContact,
  updateEntry,
  updateGroup,
  updateHeader,
  updateSectionTitle,
  updateTextBody,
  type MoveDirection
} from './resumeEditorLogic'

/*
 * The structured editor shared by the master resume and every variant. It
 * is a controlled component over `ResumeContent`: the page owns the draft
 * and the dirty flag, this only turns inputs into `resumeEditorLogic` calls.
 *
 * It knows nothing about section *meaning*, only about the four layouts, so
 * "Volunteering" and "Experience" get the same form. Bullets and list items
 * are edited as one-per-line text rather than as individual rows: a resume
 * bullet is a single line by construction, and one textarea is denser and
 * easier to reorder than a stack of inputs with move buttons each.
 *
 * Sections stay open one at a time (an accordion): with ten sections of
 * five entries each, showing every field at once made the form several
 * screens tall, and the preview beside it is what the user is watching.
 */

interface ResumeEditorProps {
  content: ResumeContent
  onChange: (next: ResumeContent) => void
  disabled?: boolean
}

const LAYOUT_LABEL_KEYS: Record<ResumeSectionLayoutKind, 'editor.layoutText' | 'editor.layoutEntries' | 'editor.layoutGroups' | 'editor.layoutList'> = {
  text: 'editor.layoutText',
  entries: 'editor.layoutEntries',
  groups: 'editor.layoutGroups',
  list: 'editor.layoutList'
}

const LAYOUT_HINT_KEYS: Record<ResumeSectionLayoutKind, 'editor.layoutTextHint' | 'editor.layoutEntriesHint' | 'editor.layoutGroupsHint' | 'editor.layoutListHint'> = {
  text: 'editor.layoutTextHint',
  entries: 'editor.layoutEntriesHint',
  groups: 'editor.layoutGroupsHint',
  list: 'editor.layoutListHint'
}

function RowActions({
  onMove,
  onRemove,
  first,
  last,
  disabled,
  labels
}: {
  onMove: (direction: MoveDirection) => void
  onRemove: () => void
  first: boolean
  last: boolean
  disabled?: boolean
  labels: { up: string; down: string; remove: string }
}): ReactElement {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip label={labels.up}>
        <Button size="sm" variant="ghost" onClick={() => onMove('up')} disabled={disabled || first} aria-label={labels.up}>
          ↑
        </Button>
      </Tooltip>
      <Tooltip label={labels.down}>
        <Button size="sm" variant="ghost" onClick={() => onMove('down')} disabled={disabled || last} aria-label={labels.down}>
          ↓
        </Button>
      </Tooltip>
      <Tooltip label={labels.remove}>
        <Button size="sm" variant="ghost" onClick={onRemove} disabled={disabled} aria-label={labels.remove}>
          ×
        </Button>
      </Tooltip>
    </div>
  )
}

export default function ResumeEditor({ content, onChange, disabled = false }: ResumeEditorProps): ReactElement {
  const { t } = useTranslation('resumes')
  const [openSectionId, setOpenSectionId] = useState<string | null>(content.sections[0]?.id ?? null)
  const [newLayout, setNewLayout] = useState<ResumeSectionLayoutKind>('entries')

  const rowLabels = { up: t('editor.moveUp'), down: t('editor.moveDown'), remove: t('editor.remove') }
  const layoutOptions = RESUME_SECTION_LAYOUT_KINDS.map((kind) => ({ value: kind, label: t(LAYOUT_LABEL_KEYS[kind]) }))

  const handleAddSection = (): void => {
    const next = addSection(content, newLayout)
    onChange(next)
    setOpenSectionId(next.sections.at(-1)?.id ?? null)
  }

  return (
    <div className="flex flex-col gap-3">
      <fieldset disabled={disabled} className="flex flex-col gap-2 border border-border-soft p-3">
        <legend className="px-1 text-[12px] font-medium uppercase tracking-wide text-text-faint">{t('editor.header')}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField
            label={t('editor.fullName')}
            value={content.header.fullName}
            onChange={(event) => onChange(updateHeader(content, { fullName: event.target.value }))}
            required
          />
          <TextField
            label={t('editor.headline')}
            value={content.header.headline ?? ''}
            onChange={(event) => onChange(updateHeader(content, { headline: event.target.value }))}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-text-muted">{t('editor.contacts')}</span>
          <Button size="sm" onClick={() => onChange(addContact(content))}>
            {t('editor.addContact')}
          </Button>
        </div>
        {content.header.contacts.map((contact, index) => (
          <div key={contact.id} className="flex items-end gap-2">
            <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
              <TextField
                id={`contact-label-${contact.id}`}
                label={t('editor.contactLabel')}
                value={contact.label}
                onChange={(event) => onChange(updateContact(content, contact.id, { label: event.target.value }))}
              />
              <TextField
                id={`contact-value-${contact.id}`}
                label={t('editor.contactValue')}
                value={contact.value}
                onChange={(event) => onChange(updateContact(content, contact.id, { value: event.target.value }))}
                required
              />
              <TextField
                id={`contact-url-${contact.id}`}
                label={t('editor.contactUrl')}
                value={contact.url ?? ''}
                onChange={(event) => onChange(updateContact(content, contact.id, { url: event.target.value }))}
              />
            </div>
            <RowActions
              labels={rowLabels}
              disabled={disabled}
              first={index === 0}
              last={index === content.header.contacts.length - 1}
              onMove={(direction) => onChange(moveContact(content, contact.id, direction))}
              onRemove={() => onChange(removeContact(content, contact.id))}
            />
          </div>
        ))}
      </fieldset>

      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium uppercase tracking-wide text-text-faint">{t('editor.sections')}</span>
        <div className="flex items-center gap-2">
          <Dropdown
            size="sm"
            className="w-36"
            ariaLabel={t('editor.layout')}
            options={layoutOptions}
            value={newLayout}
            onChange={(value) => setNewLayout(value as ResumeSectionLayoutKind)}
            disabled={disabled}
          />
          <Button size="sm" variant="primary" onClick={handleAddSection} disabled={disabled}>
            {t('editor.addSection')}
          </Button>
        </div>
      </div>

      {content.sections.map((section, index) => (
        <SectionEditor
          key={section.id}
          section={section}
          open={openSectionId === section.id}
          onToggle={() => setOpenSectionId(openSectionId === section.id ? null : section.id)}
          first={index === 0}
          last={index === content.sections.length - 1}
          disabled={disabled}
          rowLabels={rowLabels}
          layoutOptions={layoutOptions}
          onMove={(direction) => onChange(moveSection(content, section.id, direction))}
          onRemove={() => onChange(removeSection(content, section.id))}
          onTitle={(title) => onChange(updateSectionTitle(content, section.id, title))}
          onLayout={(kind) => onChange(changeSectionLayout(content, section.id, kind))}
          onText={(body) => onChange(updateTextBody(content, section.id, body))}
          onListItems={(items) => onChange(setListItems(content, section.id, items))}
          onAddEntry={() => onChange(addEntry(content, section.id))}
          onEntry={(entryId, patch) => onChange(updateEntry(content, section.id, entryId, patch))}
          onMoveEntry={(entryId, direction) => onChange(moveEntry(content, section.id, entryId, direction))}
          onRemoveEntry={(entryId) => onChange(removeEntry(content, section.id, entryId))}
          onAddGroup={() => onChange(addGroup(content, section.id))}
          onGroup={(groupId, patch) => onChange(updateGroup(content, section.id, groupId, patch))}
          onMoveGroup={(groupId, direction) => onChange(moveGroup(content, section.id, groupId, direction))}
          onRemoveGroup={(groupId) => onChange(removeGroup(content, section.id, groupId))}
        />
      ))}

      <p className="text-[11px] text-text-faint">{t('editor.idsNote')}</p>
    </div>
  )
}

interface SectionEditorProps {
  section: ResumeSection
  open: boolean
  onToggle: () => void
  first: boolean
  last: boolean
  disabled: boolean
  rowLabels: { up: string; down: string; remove: string }
  layoutOptions: { value: string; label: string }[]
  onMove: (direction: MoveDirection) => void
  onRemove: () => void
  onTitle: (title: string) => void
  onLayout: (kind: ResumeSectionLayoutKind) => void
  onText: (body: string) => void
  onListItems: (items: string[]) => void
  onAddEntry: () => void
  onEntry: (entryId: string, patch: Partial<Omit<ResumeEntry, 'id'>>) => void
  onMoveEntry: (entryId: string, direction: MoveDirection) => void
  onRemoveEntry: (entryId: string) => void
  onAddGroup: () => void
  onGroup: (groupId: string, patch: Partial<Omit<ResumeGroup, 'id'>>) => void
  onMoveGroup: (groupId: string, direction: MoveDirection) => void
  onRemoveGroup: (groupId: string) => void
}

function SectionEditor(props: SectionEditorProps): ReactElement {
  const { t } = useTranslation('resumes')
  const { section, open, disabled, rowLabels } = props
  const layoutLocked = !canChangeLayout(section)

  return (
    <div className="border border-border-soft">
      <div className="flex h-7 items-center gap-2 bg-canvas-soft px-2">
        <button
          type="button"
          onClick={props.onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[12px] font-medium text-text"
        >
          <span aria-hidden className="w-3 text-text-faint">
            {open ? '▾' : '▸'}
          </span>
          <span className="min-w-0 truncate">{section.title.trim() || t('editor.untitledSection')}</span>
          <Tag label={t(LAYOUT_LABEL_KEYS[section.layout.kind])} />
        </button>
        <RowActions
          labels={rowLabels}
          disabled={disabled}
          first={props.first}
          last={props.last}
          onMove={props.onMove}
          onRemove={props.onRemove}
        />
      </div>
      {open && (
        <fieldset disabled={disabled} className="flex flex-col gap-2 border-t border-border-soft p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
            <TextField
              id={`section-title-${section.id}`}
              label={t('editor.sectionTitle')}
              value={section.title}
              onChange={(event) => props.onTitle(event.target.value)}
              required
            />
            <Tooltip label={layoutLocked ? t('editor.layoutLocked') : t(LAYOUT_HINT_KEYS[section.layout.kind])}>
              <div className="flex flex-col gap-1">
                <span className="text-[12px] font-medium text-text-muted">{t('editor.layout')}</span>
                <Dropdown
                  className="w-40"
                  ariaLabel={t('editor.layout')}
                  options={props.layoutOptions}
                  value={section.layout.kind}
                  onChange={(value) => props.onLayout(value as ResumeSectionLayoutKind)}
                  disabled={disabled || layoutLocked}
                />
              </div>
            </Tooltip>
          </div>

          {section.layout.kind === 'text' && (
            <TextArea
              id={`section-body-${section.id}`}
              label={t('editor.body')}
              rows={4}
              value={section.layout.body}
              onChange={(event) => props.onText(event.target.value)}
            />
          )}

          {section.layout.kind === 'list' && (
            <TextArea
              id={`section-items-${section.id}`}
              label={t('editor.items')}
              hint={t('editor.oneItemPerLine')}
              rows={4}
              defaultValue={listToLines(section.layout.items)}
              onBlur={(event) => props.onListItems(linesToList(event.target.value))}
            />
          )}

          {section.layout.kind === 'entries' && (
            <>
              {section.layout.entries.map((entry, index, entries) => (
                <div key={entry.id} className="flex flex-col gap-2 border border-border-soft p-2">
                  <div className="flex items-end gap-2">
                    <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                      <TextField
                        id={`entry-title-${entry.id}`}
                        label={t('editor.entryTitle')}
                        value={entry.title}
                        onChange={(event) => props.onEntry(entry.id, { title: event.target.value })}
                        required
                      />
                      <TextField
                        id={`entry-subtitle-${entry.id}`}
                        label={t('editor.entrySubtitle')}
                        value={entry.subtitle ?? ''}
                        onChange={(event) => props.onEntry(entry.id, { subtitle: event.target.value })}
                      />
                    </div>
                    <RowActions
                      labels={rowLabels}
                      disabled={disabled}
                      first={index === 0}
                      last={index === entries.length - 1}
                      onMove={(direction) => props.onMoveEntry(entry.id, direction)}
                      onRemove={() => props.onRemoveEntry(entry.id)}
                    />
                  </div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <TextField
                      id={`entry-meta-${entry.id}`}
                      label={t('editor.entryMeta')}
                      value={entry.meta ?? ''}
                      onChange={(event) => props.onEntry(entry.id, { meta: event.target.value })}
                    />
                    <TextField
                      id={`entry-start-${entry.id}`}
                      label={t('editor.entryStart')}
                      value={entry.start ?? ''}
                      onChange={(event) => props.onEntry(entry.id, { start: event.target.value })}
                    />
                    <TextField
                      id={`entry-end-${entry.id}`}
                      label={t('editor.entryEnd')}
                      value={entry.end ?? ''}
                      onChange={(event) => props.onEntry(entry.id, { end: event.target.value })}
                    />
                    <TextField
                      id={`entry-url-${entry.id}`}
                      label={t('editor.entryUrl')}
                      value={entry.url ?? ''}
                      onChange={(event) => props.onEntry(entry.id, { url: event.target.value })}
                    />
                  </div>
                  <TextArea
                    id={`entry-bullets-${entry.id}`}
                    label={t('editor.bullets')}
                    hint={t('editor.oneItemPerLine')}
                    rows={Math.min(8, Math.max(2, entry.bullets.length + 1))}
                    defaultValue={listToLines(entry.bullets)}
                    onBlur={(event) => props.onEntry(entry.id, { bullets: linesToList(event.target.value) })}
                  />
                </div>
              ))}
              <div>
                <Button size="sm" onClick={props.onAddEntry}>
                  {t('editor.addEntry')}
                </Button>
              </div>
            </>
          )}

          {section.layout.kind === 'groups' && (
            <>
              {section.layout.groups.map((group, index, groups) => (
                <div key={group.id} className="flex items-start gap-2">
                  <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[10rem_1fr]">
                    <TextField
                      id={`group-label-${group.id}`}
                      label={t('editor.groupLabel')}
                      value={group.label}
                      onChange={(event) => props.onGroup(group.id, { label: event.target.value })}
                      required
                    />
                    <TextArea
                      id={`group-items-${group.id}`}
                      label={t('editor.groupItems')}
                      hint={t('editor.oneItemPerLine')}
                      rows={2}
                      defaultValue={listToLines(group.items)}
                      onBlur={(event) => props.onGroup(group.id, { items: linesToList(event.target.value) })}
                    />
                  </div>
                  <div className="pt-5">
                    <RowActions
                      labels={rowLabels}
                      disabled={disabled}
                      first={index === 0}
                      last={index === groups.length - 1}
                      onMove={(direction) => props.onMoveGroup(group.id, direction)}
                      onRemove={() => props.onRemoveGroup(group.id)}
                    />
                  </div>
                </div>
              ))}
              <div>
                <Button size="sm" onClick={props.onAddGroup}>
                  {t('editor.addGroup')}
                </Button>
              </div>
            </>
          )}
        </fieldset>
      )}
    </div>
  )
}
