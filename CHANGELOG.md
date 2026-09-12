# Changelog

Notable changes to Applyer are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

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
