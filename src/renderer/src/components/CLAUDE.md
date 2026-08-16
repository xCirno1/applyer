# Components Catalog

Reusable UI lives under `src/renderer/src/components/`, organized by concern:

- `components/ui/` — generic, app-agnostic primitives (buttons, modals, toasts, form fields, the resize handle). Nothing here knows about jobs, profiles, or the terminal.
- `components/terminal/` — the embedded terminal pane and anything specific to driving it.
- `components/board/` — the job task board (Kanban columns, job cards, detail modal, captcha alert banner, filters, the pipeline overview sidebar).
- `components/workspace/` — the panel arrangement gluing board/terminal/logs into one screen (the resizable dock, layout persistence). Domain-agnostic in principle but currently only used by the one workspace screen, so it stays split from `ui/` until a second consumer shows up.
- `components/onboarding/` — onboarding-specific composite widgets.
- `components/settings/` — widgets shared between onboarding and the Settings page (currently just the MCP connection card — onboarding's McpSetup step and Settings > Connections both render the same `McpCliCard` list).

Page-level composition (switching between Onboarding / Workspace / Settings) lives in `src/renderer/src/pages/`, not here — pages assemble components, they aren't reusable themselves. `src/renderer/src/providers/` holds app-wide context providers (currently `CaptchaAlertProvider`) — one level up from `components/` since they wrap the whole app rather than rendering UI themselves.

The main screen is a single panel-based workspace (`pages/Workspace/WorkspacePage.tsx`), not per-feature pages — the pipeline overview, kanban board, and terminal/console dock are three simultaneous resizable regions rather than three destinations you navigate between. Settings remains a separate screen (real settings surface, not live data), reached via the header's gear button and kept mounted-but-hidden alongside the workspace so it doesn't kill the terminal's pty session or the jobs live-update subscription.

## Existing components

| Component | Path | Notes |
|---|---|---|
| `TerminalPane` | `terminal/TerminalPane.tsx` | xterm.js view bound 1:1 to a main-process `node-pty` session via `window.api.terminal`. Owns its own session lifecycle (create on mount, dispose on unmount). Reused inside `workspace/WorkspaceDock.tsx`'s Terminal tab (kept mounted via CSS visibility across dock-tab switches so the pty session survives). |
| `Button` | `ui/Button.tsx` | Variants: primary/secondary/danger/ghost. Sizes: sm (h-6) / md (h-7). `loading` prop shows a spinner and disables the button — the standard pattern for any action that hits IPC. |
| `Spinner` | `ui/Spinner.tsx` | Small inline spinner, used by `Button` and standalone. |
| `Skeleton` | `ui/Skeleton.tsx` | Pulsing placeholder block for loading states (board columns, boot screen). |
| `Tooltip` | `ui/Tooltip.tsx` | Hover/focus tooltip for idiomatic or technical terms. |
| `ToastContext` / `ToastProvider` / `useToast` | `ui/ToastContext.ts`, `ui/ToastProvider.tsx`, `ui/useToast.ts` | Toast notification system — context split into its own file so `ToastProvider.tsx` stays a component-only export (required for Fast Refresh). Mounted once at the root of `App.tsx`. Use `useToast().success/error/info(message)`. |
| `Modal` | `ui/Modal.tsx` | Base modal (backdrop + panel, `shadow-overlay`), Escape-to-close. |
| `ConfirmDialog` | `ui/ConfirmDialog.tsx` | Built on `Modal` — the only way to ask "are you sure?"; never use native `confirm()`. |
| `Tag` | `ui/Tag.tsx` | Plain bordered rectangle with text (tones: neutral/danger/warning/success) — never a pill, never a dot-chip. Used for job failure-reason tags. |
| `TextField` | `ui/TextField.tsx` | Labeled text input, dense (h-7), optional hint/error text. |
| `Select` | `ui/Select.tsx` | Labeled field wrapper around `Dropdown`, dense (h-7). |
| `Dropdown` | `ui/Dropdown.tsx` | Custom listbox replacing native `<select>` (same interaction model: click/ArrowDown to open, arrows+Enter to pick, Escape to close), styled to match the app's other controls. Option panel is measured off the trigger and rendered `position: fixed` — no portal needed, since `fixed` already escapes ancestor clipping. Used directly (unlabeled, toolbar-style) by `BoardFilters` and `LogsPage`'s level filter; wrapped by `Select` wherever a labeled field is needed. |
| `FileDrop` | `ui/FileDrop.tsx` | Click-or-drag file upload zone (onboarding documents). |
| `DonutChart` | `ui/DonutChart.tsx` | Part-to-whole donut built from stroked SVG circles — no chart library. Takes `segments` (`{key, value, strokeClassName}`), an optional center label/sublabel; drops non-positive values and renders an empty track rather than dividing by zero when the total is 0. Used by `PipelineOverview` for the per-status job breakdown. |
| `StorageModeCard` | `onboarding/StorageModeCard.tsx` | Selectable card for the plain-language encrypted-vs-plaintext choice; supports a disabled state with reason (e.g. no OS keychain available). |
| `McpConfigSnippet` | `onboarding/McpConfigSnippet.tsx` | Copyable code block for the manual MCP config snippet. |
| `KanbanBoard` | `board/KanbanBoard.tsx` | The four-column board (Queued/Filled/Submitted/Failed), horizontally scrolling. Which job's detail modal is open lives in `jobsStore` (`openJobId`/`openJob`/`closeJob`) rather than local state, so `PipelineOverview`'s verification list can open the same modal; the active job is re-derived live from the store (not a static snapshot) so it reflects real-time updates while open. |
| `PipelineOverview` | `board/PipelineOverview.tsx` | The workspace's left sidebar — a `DonutChart` + legend of per-status job counts/share, and a "needs verification" list (from `CaptchaAlertContext`'s `pending`, clickable to open that job's detail modal via `jobsStore`). The analogue of a persistent analysis rail alongside the board, rather than requiring a separate page. |
| `KanbanColumn` | `board/KanbanColumn.tsx` | One status column — fetches its own page via `jobsStore`, skeleton while loading, "Load more" pagination (no virtualization yet; revisit if column sizes grow large — see plan Phase 3). |
| `JobCard` | `board/JobCard.tsx` | Dense job row — left border color signals status instead of a badge; shows a `Tag` for the failure reason when present. |
| `JobDetailModal` | `board/JobDetailModal.tsx` | Full job detail (description rendered as sanitized HTML, match reasons, a screenshot preview for Filled jobs served via the `applyer-file://` protocol, status-contextual actions: Retry for Failed, Mark Submitted for Filled, Exclude for anything not yet Submitted — all behind spinner+disable / `ConfirmDialog`, never a bare click). Excluding removes the job from the board and blacklists its URL (see `pages/Settings/ExclusionsSection.tsx`). |
| `CaptchaAlertBanner` | `board/CaptchaAlertBanner.tsx` | Full-width banner rows (one per pending challenge) shown above the board when `fill_application` hits a verification challenge — Resume (re-checks the challenge is actually cleared before resolving) / Cancel (fails the job as `captcha_verification`) per row. Driven by `CaptchaAlertProvider`, not self-subscribing. |
| `CaptchaAlertProvider` / `useBlockedJobIds` / `usePendingCaptchaAlerts` | `providers/CaptchaAlertProvider.tsx`, `providers/CaptchaAlertContext.ts` | Subscribes to `captcha:detected`/`captcha:resolved` IPC pushes, renders `CaptchaAlertBanner`, and exposes both which job ids are currently blocked (`useBlockedJobIds`, so `JobCard` can show a "needs verification" tag) and the full pending payload list (`usePendingCaptchaAlerts`, so `PipelineOverview` can render title/company without depending on which page of a column happens to be loaded). Wraps `<main>` in `App.tsx`'s main shell. |
| `BoardFilters` | `board/BoardFilters.tsx` | Search (debounced)/source/sort controls above the board, backed by `jobsStore`'s `filters` state — changing any of them refetches all four columns from the server (filtering isn't done client-side). |
| `McpCliCard` | `settings/McpCliCard.tsx` (labels in `settings/mcpCliLabels.ts`, split out for Fast Refresh) | One CLI's connection status + copyable snippet + Auto-configure (behind `ConfirmDialog`) + Verify connection. Used by both onboarding's `McpSetup` and Settings > Connections — the only difference between those two call sites is surrounding page chrome. |
| `ResizeHandle` | `ui/ResizeHandle.tsx` | Draggable 1px seam between two resizable panels (vertical or horizontal), widened hit area via a `::after` overhang, real focusable `separator` with arrow-key resizing. Used by `WorkspacePage` for the overview/board and board/dock seams. |
| `WorkspaceDock` | `workspace/WorkspaceDock.tsx` | The bottom dock: Terminal and Activity Log as tabs of one region rather than two pages — both stay mounted (CSS visibility) across tab switches so the terminal's pty session isn't killed and Logs doesn't re-fetch on every switch. |
| `ViewMenu` | `workspace/ViewMenu.tsx` | Menu-bar-style "View" dropdown in the topbar (à la VS Code) listing checkable panel-visibility toggles (Overview/Console) instead of standalone buttons — `absolute`-positioned off its own trigger, since it only ever opens inside the header. |
| `useWorkspaceLayout` / `workspaceLayout.ts` | `workspace/useWorkspaceLayout.ts`, `workspace/workspaceLayout.ts` | Panel visibility + sidebar width + dock height + active dock tab, persisted to `localStorage` (debounced writes, flushed on `beforeunload`). Clamping/parsing logic lives in the plain `.ts` module (no React) so it's independently testable; the hook wraps it with debounced persistence. |

Update this table whenever a component is added, moved, or removed.
