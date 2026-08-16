# Components Catalog

Reusable UI lives under `src/renderer/src/components/`, organized by concern:

- `components/ui/` — generic, app-agnostic primitives (buttons, modals, toasts, form fields). Nothing here knows about jobs, profiles, or the terminal.
- `components/terminal/` — the embedded terminal pane and anything specific to driving it.
- `components/board/` — the job task board (Kanban columns, job cards, detail modal, captcha alert banner, filters).
- `components/onboarding/` — onboarding-specific composite widgets.
- `components/settings/` — widgets shared between onboarding and the Settings page (currently just the MCP connection card — onboarding's McpSetup step and Settings > Connections both render the same `McpCliCard` list).

Page-level composition (routing between Onboarding / Board / Terminal) lives in `src/renderer/src/pages/`, not here — pages assemble components, they aren't reusable themselves. `src/renderer/src/providers/` holds app-wide context providers (currently `CaptchaAlertProvider`) — one level up from `components/` since they wrap the whole app rather than rendering UI themselves.

## Existing components

| Component | Path | Notes |
|---|---|---|
| `TerminalPane` | `terminal/TerminalPane.tsx` | xterm.js view bound 1:1 to a main-process `node-pty` session via `window.api.terminal`. Owns its own session lifecycle (create on mount, dispose on unmount). Reused directly inside `App.tsx`'s main shell (kept mounted across tab switches so the pty session survives). |
| `Button` | `ui/Button.tsx` | Variants: primary/secondary/danger/ghost. Sizes: sm (h-6) / md (h-7). `loading` prop shows a spinner and disables the button — the standard pattern for any action that hits IPC. |
| `Spinner` | `ui/Spinner.tsx` | Small inline spinner, used by `Button` and standalone. |
| `Skeleton` | `ui/Skeleton.tsx` | Pulsing placeholder block for loading states (board columns, boot screen). |
| `Tooltip` | `ui/Tooltip.tsx` | Hover/focus tooltip for idiomatic or technical terms. |
| `ToastContext` / `ToastProvider` / `useToast` | `ui/ToastContext.ts`, `ui/ToastProvider.tsx`, `ui/useToast.ts` | Toast notification system — context split into its own file so `ToastProvider.tsx` stays a component-only export (required for Fast Refresh). Mounted once at the root of `App.tsx`. Use `useToast().success/error/info(message)`. |
| `Modal` | `ui/Modal.tsx` | Base modal (backdrop + panel, `shadow-overlay`), Escape-to-close. |
| `ConfirmDialog` | `ui/ConfirmDialog.tsx` | Built on `Modal` — the only way to ask "are you sure?"; never use native `confirm()`. |
| `Tag` | `ui/Tag.tsx` | Plain bordered rectangle with text (tones: neutral/danger/warning/success) — never a pill, never a dot-chip. Used for job failure-reason tags. |
| `TextField` | `ui/TextField.tsx` | Labeled text input, dense (h-7), optional hint/error text. |
| `Select` | `ui/Select.tsx` | Labeled select, dense (h-7). |
| `FileDrop` | `ui/FileDrop.tsx` | Click-or-drag file upload zone (onboarding documents). |
| `StorageModeCard` | `onboarding/StorageModeCard.tsx` | Selectable card for the plain-language encrypted-vs-plaintext choice; supports a disabled state with reason (e.g. no OS keychain available). |
| `McpConfigSnippet` | `onboarding/McpConfigSnippet.tsx` | Copyable code block for the manual MCP config snippet. |
| `KanbanBoard` | `board/KanbanBoard.tsx` | The four-column board (Queued/Filled/Submitted/Failed), horizontally scrolling. Owns which job's detail modal is open, re-derived live from the jobs store (not a static snapshot) so it reflects real-time updates while open. |
| `KanbanColumn` | `board/KanbanColumn.tsx` | One status column — fetches its own page via `jobsStore`, skeleton while loading, "Load more" pagination (no virtualization yet; revisit if column sizes grow large — see plan Phase 3). |
| `JobCard` | `board/JobCard.tsx` | Dense job row — left border color signals status instead of a badge; shows a `Tag` for the failure reason when present. |
| `JobDetailModal` | `board/JobDetailModal.tsx` | Full job detail (description rendered as sanitized HTML, match reasons, a screenshot preview for Filled jobs served via the `jobhunt-file://` protocol, status-contextual actions: Retry for Failed, Mark Submitted for Filled — both behind spinner+disable / `ConfirmDialog`, never a bare click). |
| `CaptchaAlertBanner` | `board/CaptchaAlertBanner.tsx` | Full-width banner rows (one per pending challenge) shown above the board when `fill_application` hits a verification challenge — Resume (re-checks the challenge is actually cleared before resolving) / Cancel (fails the job as `captcha_verification`) per row. Driven by `CaptchaAlertProvider`, not self-subscribing. |
| `CaptchaAlertProvider` / `useBlockedJobIds` | `providers/CaptchaAlertProvider.tsx`, `providers/CaptchaAlertContext.ts` | Subscribes to `captcha:detected`/`captcha:resolved` IPC pushes, renders `CaptchaAlertBanner`, and exposes which job ids are currently blocked (via context, split out for Fast Refresh) so `JobCard` can show a "needs verification" tag. Wraps `<main>` in `App.tsx`'s main shell. |
| `BoardFilters` | `board/BoardFilters.tsx` | Search (debounced)/source/sort controls above the board, backed by `jobsStore`'s `filters` state — changing any of them refetches all four columns from the server (filtering isn't done client-side). |
| `McpCliCard` | `settings/McpCliCard.tsx` (labels in `settings/mcpCliLabels.ts`, split out for Fast Refresh) | One CLI's connection status + copyable snippet + Auto-configure (behind `ConfirmDialog`) + Verify connection. Used by both onboarding's `McpSetup` and Settings > Connections — the only difference between those two call sites is surrounding page chrome. |

Update this table whenever a component is added, moved, or removed.
