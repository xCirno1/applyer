# Changelog

Notable changes to Applyer are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.1.0] - 2026-09-18

### Added

**Chat with an in-app agent (OpenRouter mode)**

- Applyer can now run its own agent instead of a CLI. Connect an OpenRouter account
  from Settings > Agent (or during onboarding), pick any tool-capable model, and chat
  in a panel on the right of every screen.
- Sign-in happens in your browser; no API key to paste. The key is kept in your OS
  keychain.
- Chats are saved locally, encrypted like the rest of your data, and included in
  export/import. Sessions can be renamed, searched and deleted.
- Replies stream in as markdown. Each tool call is one row you can open to see what
  was sent and what came back, in plain tables or raw JSON.
- Tools that change data pause for an Allow/Deny before running. Which ones ask is
  configurable in Settings > Agent.
- Switching between CLI and OpenRouter mode never loses anything: the terminal and
  the chat each keep their state.

**Run statistics**

- A new Runs screen. Start a run before giving the agent a task and stop it when done;
  everything in between is counted per site: searches, postings read, jobs queued,
  forms filled, challenges hit, submissions, failures, tool calls and more.
- Runs survive an app restart, and past runs can be reopened, renamed and deleted. A
  timeline lists what happened in order.

**More job sources and smarter search**

- Four new sources: Seek (Australia and New Zealand), Jora, Prosple (graduate roles
  across Asia-Pacific) and Remotive (remote-only).
- Results from different sites are interleaved so no single site crowds the page, and
  duplicate listings are dropped in favour of the original.
- A job search country setting (Settings > Job search) picks the national edition of
  Indeed, Jora, Seek and Prosple. The agent can also pass a country for a single search.
- When a site blocks the hidden browser with a verification challenge, the search is
  retried in a visible window. A banner above the board shows which site is waiting,
  and the search resumes as soon as the challenge clears. This can be turned off in
  Settings > Job search.
- The source filters on the board and Indexed Jobs list every source by name.

**Resume variants**

- A new Resume Variants screen. Keep one master resume and any number of named
  variants ("Backend-focused", "Concise one-page", or one for a specific posting),
  each with three templates to choose from, an in-app editor and PDF export.
- Assign a variant to a job from its details; several jobs can share one. The agent
  can build the master from your uploaded resume, write and assign variants, and
  attach the right one when it fills an application.
- The preview shows real page breaks, and the diff view marks a variant's changes
  right on the resume (additions in green, removals struck through).
- Font family and size are adjustable on the master; variants inherit them.
- Leaving or closing with unsaved resume edits asks first.

**Everywhere else**

- The terminal dock now sits under every screen, and it is the same session
  throughout, so an agent keeps working while you move between pages.
- Resume prompts have a Send to terminal button that types the sentence for you.
- Queued jobs can be marked as Filled manually, one at a time or in bulk.
- Settings > Browser can attach to a browser you already have running (signed in and
  all) instead of launching a separate one. Nothing is copied from its profile.
- Cloudflare's newer "Just a moment..." page is recognised as a challenge instead of
  being reported as "no listings".
- The local test job site shows which file reached the resume upload field.

### Changed

- `edit_application` now works on Queued jobs too, not only Filled ones. A wrong
  answer mid-fill is corrected in place and the fill carries on.

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
