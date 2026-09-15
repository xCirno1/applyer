# Changelog

Notable changes to Applyer are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Run statistics (the Runs screen on the left rail). Start a run before handing the agent a task and
  stop it when the task is done; everything the app observes in between is counted, per
  site: searches and what each site returned (or whether it answered with a challenge),
  postings read, jobs queued with their match scores, forms inspected and filled (fields
  filled and skipped, permission refusals, buttons clicked), verification challenges hit
  and resolved, jobs submitted, failed (by reason), retried, unqueued, removed and
  excluded, resumes attached and variants written, profile and company-board changes,
  and every MCP tool call with its duration. The numbers are folded from a per-run event
  log rather than kept as counters, so a run survives an app restart, past runs can be
  reopened, renamed and deleted (the run picker reads the history a page at a time, so
  the oldest run stays reachable), and a timeline lists what happened in order. A search now
  also reports what each source returned before cross-source dedupe (`sourceOutcomes`).
- Four more job sources for `search_jobs` and `get_job_details`: Seek (Australia and
  New Zealand), Jora (Seek's worldwide aggregator), Prosple (graduate programs and
  internships across Asia-Pacific), and Remotive (remote-only roles, read through its
  public API rather than a browser; the feed is downloaded at most a few times a day, as
  the API's terms ask, and every search is answered from that copy). Every search interleaves the sites so the one with
  the most results does not fill the page, and a Jora copy of a posting that any other
  source also returned is dropped in favour of the original, since Jora only re-lists
  what other boards publish. Posting pages are read from their schema.org `JobPosting`
  markup first and from the site's own layout second, so a redesign degrades a source
  rather than breaking it. Seek, Jora and Prosple were checked against the live sites.
- A job search a site refuses to answer from the hidden browser is retried in the
  application browser. Prosple sits behind Cloudflare's managed challenge, which turns
  away every headless browser and lets the same page through a visible window within
  seconds; so when a search comes back challenged, the page is opened in the application
  browser (or the attached one, when Settings > Browser attaches to your own and it is
  running; a search falls back to Applyer's own window when it is not), a banner
  above the board says which site is waiting and a desktop notification goes out under the
  existing "verification required" switch, and the search resumes as soon as the challenge
  clears, by itself or with your click; Skip gives that one site up for this search and the
  others carry on. The window stays open two minutes at most, so the agent's tool call still
  answers. A switch under Settings > Job search turns the retry off, in which case the site
  is reported as blocked, as before. The run timeline lists these pauses per site.
- A job search country (Settings > Job search). Indeed, Jora, Seek and Prosple are one
  site per country, each with its own listings, and every search used to hit the US
  edition; the setting picks the edition (`au.indeed.com`, `nz.seek.com`), the settings
  page shows which sites a search from that country reaches, and the agent can pass
  `country` to `search_jobs` to look somewhere else for one query. A gear beside the
  board's source filter opens that section, since the filter strip is where someone
  wondering why a site never shows up is looking. The country travels
  with export/import alongside the other settings. Job URLs from any national edition
  of Indeed, Jora or Prosple now route to the right adapter instead of the generic
  fallback.
- The source filters on the board and the Indexed Jobs page list every searchable
  source, and indexed rows show the source's name rather than its id.

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
- Cloudflare's current "Just a moment..." interstitial (randomised element ids, a
  Turnstile widget smaller than the old size gate) is now recognised as a challenge, so a
  search on a site behind it (Prosple, for one) is retried in the application browser
  instead of coming back as "no listings matched".

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
