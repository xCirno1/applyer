# Components Catalog

Reusable UI lives under `src/renderer/src/components/`, organized by concern:

- `components/ui/` — generic, app-agnostic primitives (buttons, modals, toasts, form fields, the resize handle). Nothing here knows about jobs, profiles, or the terminal.
- `components/terminal/` — the embedded terminal pane and anything specific to driving it. `terminalKeys.ts` is the plain-module half of `TerminalPane`: which keystrokes the terminal handles itself (copy/paste/newline/word-delete), the bytes Shift+Enter and Ctrl+Backspace send, and a tracker for the Kitty keyboard protocol's mode stack — no xterm or DOM state, so the rules are testable without mounting a terminal (same split as `workspace/workspaceLayout.ts` vs `useWorkspaceLayout.ts`).
- `components/board/` — the job task board (Kanban columns, job cards, detail modal, captcha alert banner, filters, the pipeline overview sidebar).
- `components/workspace/` — the panel arrangement gluing board/terminal/logs into one screen (the resizable dock, layout persistence). Domain-agnostic in principle but currently only used by the one workspace screen, so it stays split from `ui/` until a second consumer shows up.
- `components/onboarding/` — onboarding-specific composite widgets: the flow's own frame (`OnboardingShell` + `OnboardingStepRail`) and the storage-mode card. The frame lives here rather than in `pages/Onboarding/` for the same reason as everything else in this directory: the pages assemble steps, they don't define the chrome those steps sit in. Step *order* is the other half and stays with the pages (`pages/Onboarding/onboardingSteps.ts`), since it is what the flow navigates, not what the frame draws.
- `components/settings/` — settings-specific composite widgets: the MCP connection card and language picker shared with onboarding, plus the developer-mode advanced settings editor and its complete section/group presentation map.
- `components/companyBoards/` — the Job Discovery page's "Company Boards" tab: the watchlist of company ATS boards (Greenhouse/Lever/Ashby/Workday) that `search_jobs` fetches. Sits beside `indexedJobs/` rather than inside it because it is a different kind of list — an *input* to job discovery rather than a record of what discovery found — but on the same page for exactly that reason: none of those four providers has a cross-company search endpoint, so this list is the entire coverage of those sources, and the Indexed tab next door is where you see what it produced.
- `components/indexedJobs/` — the Indexed Jobs page's body: the "Indexed" tab's filters/list/row/retention control, showing every job a search has surfaced (matched or not), independent of the board's `columns` (queued/filled/submitted/failed only ever holds jobs the agent chose to queue); plus the "Excluded" tab's `ExclusionsPanel`, moved here from Settings since it's really a view onto the same job-discovery pipeline.
- `components/navigation/` — cross-page chrome used by `App.tsx`'s `MainShell` itself rather than owned by any one screen (`IconRail`, the left rail switching between the Workspace and Job Discovery screens, plus `DevBuildTag`, the top-bar dev-build marker). Same "split from `ui/` once there's a real consumer" reasoning as `workspace/` below, just one level higher — this is chrome *above* the screens, not glue *within* one screen.
- `components/browser/` — the browser-setup modal shown when a packaged build has to resolve/download a browser for job automation at runtime (see `useBrowserSetupState.ts`'s doc comment). Push-driven like `board/CaptchaAlertBanner.tsx`, not click-driven like `ExportModal`/`ImportModal` — mounted globally in `App.tsx`'s `MainShell` alongside them.

Page-level composition (switching between Onboarding / Workspace / Indexed Jobs / Settings) lives in `src/renderer/src/pages/`, not here — pages assemble components, they aren't reusable themselves. `pages/Onboarding/` keeps the same plain-module split the rest of the app uses: `OnboardingFlow.tsx` owns which step is showing, how deep the user has been, and the profile draft (lifted out of the form because the rail can leave that step mid-sentence, and state held in the form would be discarded on the way out), `onboardingSteps.ts` holds the order and the rail/progress arithmetic (storage mode stays ahead of the profile and document steps because those writes read the mode at write time and are never re-encrypted afterwards), `firstPrompt.ts` picks which sentence the payoff screen suggests saying to the agent first, which is how the profile step's "I'll fill this later" ends somewhere useful rather than just skipped: it suggests having the agent read the uploaded resume into the profile, which `get_profile`'s `includeDocumentText` is what makes possible without the user knowing a file path. `src/renderer/src/providers/` holds app-wide context providers (`CaptchaAlertProvider`, `ThemeProvider`, `ShortcutsProvider`) — one level up from `components/` since they wrap the whole app rather than rendering UI themselves. `src/renderer/src/i18n/` is the translation layer, with the same plain-module/provider split: `locale.ts` (supported locales, preference persistence, and resolving 'system' against `navigator.languages` — no React, fully testable), `config.ts` (i18next init; catalogs are imported statically since this is a single bundle with no origin to fetch from), `i18next.d.ts` (types every `t()` key off the English catalog, so a renamed or misspelled key is a `typecheck:web` failure rather than a raw key id in the UI), `formatError.ts` (turns the main process's `{ code, params }` errors into sentences — see `shared/types/errorCodes.ts` for why main returns codes rather than English), `format.ts` (locale-aware `Intl` date/number wrappers replacing bare `toLocaleString()`, memoised per locale since they run per row in paginated lists), and `locales/<code>/*.json` (the catalogs, one namespace per app area). `providers/LocaleProvider.tsx` is the React half, holding the preference and keeping i18next, `<html lang>`, and the main process's cached native-notification locale in sync — it wraps every boot phase in `App.tsx`, not just `MainShell`, since the storage-recovery and onboarding screens render before the shell exists. `src/renderer/src/theme/` holds the (non-React) theme preference logic `ThemeProvider` wraps — types, localStorage read/write, and the DOM-application function — plus `themeTemplates.ts`'s starter custom-CSS snippets; same "plain module, no DOM/React needed to exercise the rules" split as `workspace/workspaceLayout.ts` vs `useWorkspaceLayout.ts`. `src/renderer/src/shortcuts/` is the equivalent split for keyboard shortcuts: `commands.ts` (the canonical id/category/default-combo list — declares what an action *is*, not how to run it; display labels live in the `workspace` i18n namespace under `commands.<id>`, since this module is imported by non-React code with no access to the active locale), `keyCombo.ts` (event↔combo-id↔display-label parsing, mod-key-required by construction so plain typing is never at risk), and `shortcutBindings.ts` (localStorage overrides). `ShortcutsProvider` owns the actual window-level capture-phase keydown listener and a handler registry that mounted components populate via `useShortcutHandler(commandId, fn)` — see `terminal/TerminalGroup.tsx` and `App.tsx`'s `MainShell` (which registers both its own shortcuts and, since it now owns `useWorkspaceLayout`, the workspace panel-visibility ones too) for the registration sites, and `pages/Settings/ShortcutsSection.tsx` for the rebinding UI.

The main screen is a single panel-based workspace (`pages/Workspace/WorkspacePage.tsx`), not per-feature pages — the pipeline overview, kanban board, and terminal/console dock are three simultaneous resizable regions rather than three destinations you navigate between. The top bar (logo, `AppMenuBar`, settings gear) and a left `IconRail` (`components/navigation/IconRail.tsx`) switching between the Workspace and `pages/IndexedJobs/IndexedJobsPage.tsx` screens are both owned by `App.tsx`'s `MainShell`, not `WorkspacePage` — the top bar spans the full window width, with the rail sitting *below* it (not beside it, and not full window height), same shape as VS Code's menu bar over its activity bar. This means `MainShell` also owns `useWorkspaceLayout()` (panel visibility/sizes) and passes it down into `WorkspacePage` as props, since the top bar's `AppMenuBar` needs that state too; `WorkspacePage` itself is now just the board/dock body. Both screens stay mounted-but-hidden while the other is showing, same reasoning as Settings below. Settings remains a separate screen (real settings surface, not live data), reached via the header's gear button rather than joining the rail — its own back-button header replaces the shared top bar+rail entirely rather than sitting below them — and kept mounted-but-hidden alongside whichever of the other two is active so it doesn't kill the terminal's pty session or the jobs/indexed-jobs live-update subscriptions. `JobDetailModal` is mounted once at `App.tsx`'s `MainShell` level (not inside `KanbanBoard`) since it's driven by global state (`jobsStore`'s `openJobId`/`activeJob`) that multiple panels across multiple screens — the board, `PipelineOverview`'s verification list, and Indexed Jobs rows — can all open. `pages/Settings/ExportModal.tsx` and `ImportModal.tsx` (Settings > Data's Export/Import flows) are mounted at that same `MainShell` level for the same reason, just with plain `useState` open/close flags instead of a store, since `AppMenuBar`'s File > Export Data…/Import Data… items need to pop them directly rather than first navigating to Settings — `DataSection.tsx`'s own buttons call the same two callbacks (threaded down through `SettingsPage`'s props) so both entry points open the exact same modal instance. `components/browser/BrowserSetupModal.tsx` is mounted there too, but unlike those two it's driven by `useBrowserSetupState()` (subscribed to main-process push events) rather than a click-opened flag — nothing explicitly "opens" it, since a browser download can start on its own the first time a job action needs one.

## Existing components

The *why* for each component — behavioral quirks, the bugs a given approach was fixing, cross-component contracts — lives in a doc comment at the top of its own file (after the imports, before the first export), not here. Read that comment before changing the file. This table is only an index: what exists and where.

| Component | Path |
|---|---|
| `TerminalPane` | `terminal/TerminalPane.tsx` |
| `TerminalGroup` | `terminal/TerminalGroup.tsx` |
| `TerminalTabBar` | `terminal/TerminalTabBar.tsx` |
| `TerminalSearchBar` | `terminal/TerminalSearchBar.tsx` |
| `AgentPermissionsMenu` | `terminal/AgentPermissionsMenu.tsx` |
| `Button` | `ui/Button.tsx` |
| `Spinner` | `ui/Spinner.tsx` |
| `Skeleton` | `ui/Skeleton.tsx` |
| `CopyBlock` | `ui/CopyBlock.tsx` |
| `Callout` | `ui/Callout.tsx` |
| `ProgressBar` | `ui/ProgressBar.tsx` |
| `Tooltip` | `ui/Tooltip.tsx` |
| `Pagination` | `ui/Pagination.tsx` |
| `ToastContext` / `ToastProvider` / `useToast` | `ui/ToastContext.ts`, `ui/ToastProvider.tsx`, `ui/useToast.ts` |
| `toastInset.ts` | `ui/toastInset.ts` |
| `Modal` | `ui/Modal.tsx` |
| `ConfirmDialog` | `ui/ConfirmDialog.tsx` |
| `MetaList` | `ui/MetaList.tsx` |
| `DataTable` / `useSortableTable` / `dataTable.ts` | `ui/DataTable.tsx`, `ui/useSortableTable.ts`, `ui/dataTable.ts` |
| `rowSelection.ts` | `ui/rowSelection.ts` |
| `Tag` | `ui/Tag.tsx` |
| `TextField` | `ui/TextField.tsx` |
| `Checkbox` | `ui/Checkbox.tsx` |
| `Select` | `ui/Select.tsx` |
| `Dropdown` | `ui/Dropdown.tsx` |
| `FileDrop` | `ui/FileDrop.tsx` |
| `DonutChart` | `ui/DonutChart.tsx` |
| `StorageModeCard` | `onboarding/StorageModeCard.tsx` |
| `OnboardingShell` / `OnboardingStepRail` / `OnboardingNavContext` | `onboarding/OnboardingShell.tsx`, `onboarding/OnboardingStepRail.tsx`, `onboarding/OnboardingNavContext.ts` |
| `KanbanBoard` | `board/KanbanBoard.tsx` |
| `PipelineOverview` | `board/PipelineOverview.tsx` |
| `KanbanColumn` | `board/KanbanColumn.tsx` |
| `useJobContextMenu` | `board/useJobContextMenu.tsx` |
| `useJobActions` | `board/useJobActions.ts` |
| `BulkActionBar` | `board/BulkActionBar.tsx` |
| `JobDetailModal` | `board/JobDetailModal.tsx` |
| `DevBuildTag` | `navigation/DevBuildTag.tsx` |
| `IconRail` | `navigation/IconRail.tsx` |
| `IndexedJobsList` / `IndexedJobRow` / `IndexedJobsFilters` | `indexedJobs/` |
| `IndexedJobsDateStrip` / `indexedJobsDateStrip.ts` | `indexedJobs/` |
| `BoardBulkActionBar` | `companyBoards/BoardBulkActionBar.tsx` |
| `BoardCsvImportModal` | `companyBoards/BoardCsvImportModal.tsx` |
| `CompanyBoardsPanel` / `boardColumns.tsx` / `boardStatus.ts` | `companyBoards/` |
| `IndexedJobsRetentionControl` | `indexedJobs/IndexedJobsRetentionControl.tsx` |
| `ExclusionsPanel` | `indexedJobs/ExclusionsPanel.tsx` |
| `CaptchaAlertBanner` | `board/CaptchaAlertBanner.tsx` |
| `CaptchaAlertProvider` / `useBlockedJobIds` / `usePendingCaptchaAlerts` | `providers/CaptchaAlertProvider.tsx`, `providers/CaptchaAlertContext.ts` |
| `BoardFilters` | `board/BoardFilters.tsx` |
| `McpCliCard` | `settings/McpCliCard.tsx` (labels in `settings/mcpCliLabels.ts`, split out for Fast Refresh) |
| `LanguagePicker` | `settings/LanguagePicker.tsx` |
| `AdvancedSettingsEditor` / `SettingsDisclosure` | `settings/AdvancedSettingsEditor.tsx`, `settings/SettingsDisclosure.tsx` (hierarchy/search in `settings/advancedSettingsSections.ts`) |
| `ResizeHandle` | `ui/ResizeHandle.tsx` |
| `Collapsible` | `ui/Collapsible.tsx` |
| `WorkspaceDock` | `workspace/WorkspaceDock.tsx` |
| `Menu` / `MenuBar` | `ui/Menu.tsx` |
| `ContextMenu` | `ui/ContextMenu.tsx` |
| `AppMenuBar` | `workspace/AppMenuBar.tsx` |
| `useWorkspaceLayout` / `workspaceLayout.ts` | `workspace/useWorkspaceLayout.ts`, `workspace/workspaceLayout.ts` |
| `BrowserSetupModal` / `useBrowserSetupState` | `browser/BrowserSetupModal.tsx`, `browser/useBrowserSetupState.ts` |

Update this table whenever a component is added, moved, or removed.
