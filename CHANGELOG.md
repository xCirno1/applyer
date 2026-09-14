# Changelog

Notable changes to Applyer are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Named, reusable resume variants. A new Resume Variants screen holds the master
  resume as structured content (free-form sections, each with one of four layouts),
  three built-in templates, and any number of named variants ("Backend-focused",
  "Concise one-page", or one written for a particular posting), each with a diff
  against the master, a stale marker when the master changes, an in-app editor, and
  PDF export. Jobs point at a variant: several jobs can share one, a job's details
  has a Resume selector to pick one (or the master), and the Variants tab lists the
  jobs using each. The agent builds the master from the uploaded resume
  (`set_master_resume`), writes or replaces variants (`save_resume_variant`, which
  refuses any job, degree, project or skill category the master does not have and
  can assign the variant to a job in the same call), assigns existing ones
  (`assign_resume`), and deletes them (`delete_resume_variant`). `fill_application`
  attaches the job's variant, rendered to PDF with the bundled browser, in place of
  the uploaded file; a setting chooses whether jobs without a variant get the
  original upload or the rendered master, and an opt-in setting tells the agent to
  pick a variant for every job it queues (an existing one, or a new one when the
  posting warrants it). Resumes travel with export/import (jobs carry the name of
  the variant they use, and the two attachment settings ride with the resumes) and
  follow the storage encryption mode.
- The local test job site has a resume upload preview page that shows exactly which
  file reached the resume field.
- The terminal is always there, on every page. The terminal/logs dock now sits under
  every rail screen (Workspace, Job Discovery, Resume Variants) instead of the
  workspace only, and it is the same session throughout: an agent running in it keeps
  going while you switch pages, and each screen only remembers whether the dock is
  shown or collapsed. Resume prompts gained a Send to terminal button that types the
  sentence into the active terminal (opening one if needed); Enter is still yours.
- Clicking a template thumbnail opens the full rendered document in a popup.
- The master resume's details panel has font family and font size settings on top
  of the template (variants inherit them); every size in a template is relative to
  the body size, so one setting scales the whole page.
- The resume preview shows separate sheets with the same page breaks the PDF gets
  (headings stay with what follows them, entries and bullets are never split).
- The variant diff is drawn on the resume itself: additions highlighted green,
  removals struck through in red, reworded sentences diffed word by word, dropped
  sections kept on the page struck through, and a link whose destination changed
  behind unchanged text shows both addresses after it.
- The Resume Variants columns (variant list, details) are resizable and remember
  their widths; the columns no longer stack on a narrow window, each scrolls on its own.
- Leaving a variant with unsaved edits (selecting another one, or starting a new
  one) asks before discarding them, and so does closing the app while a resume
  edit is unsaved.
- Resume rendering: contacts print as written and hyperlink when a URL is given (a
  Links setting makes them blue or underlined instead of reading as text), the
  location sits under the dates instead of beside the employer, and a colon typed at
  the end of a skills label no longer prints twice.
- Queued jobs can now be marked as Filled manually from the job details,
  right-click menu, or bulk-selection toolbar without filling or submitting
  the application on the user's behalf.
- Settings > Browser can attach the interactive application window to a browser you
  already have running, over its remote-debugging port, instead of launching a separate
  signed-out one. Works with both Chrome 144+'s "Allow remote debugging" switch (whose
  per-launch websocket path Applyer reads from the browser's profile folder, and whose
  permission prompt it waits on and then answers once per run by holding the connection)
  and the older `--remote-debugging-port` flag. Nothing is
  copied or decrypted from that browser's profile. Read-only job searches keep using
  Applyer's own headless browser, and the setting explains what opening that port exposes
  before it can be turned on.

## [1.0.0] - 2026-09-11

### Highlights

- First public, cross-platform release for Linux, macOS, and Windows.
- Local-first job-search workspace with a live board, embedded agent terminal, indexed
  search history, company boards, and English/Indonesian UI.
- Agent-assisted application inspection, drafting, and editing with explicit permission
  gates for navigation and no agent-accessible final submission action.
- Complete optional encryption for the database, documents, screenshots, and logs, backed
  by the operating-system keychain.
- Reproducible per-OS packaging, SHA-256 checksums, and automated GitHub Release publishing.

### Security

- Hardened IPC payloads, browser URL handling, local MCP transport, temporary files,
  imported settings, and CSV exports.
- Updated the dependency tree to resolve all known npm audit advisories at release time.

[Unreleased]: https://github.com/xCirno1/applyer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/xCirno1/applyer/releases/tag/v1.0.0
