<div align="center">
  <img src="src/renderer/src/assets/logo.png" width="76" height="76" alt="Applyer logo" />

  # Applyer

  **Turn the coding agent you already use into a focused job-search copilot.**

  Search, compare, queue, and draft applications in one local desktop workspace.
  The agent handles repetition; you control every consequential action.

  [![CI](https://github.com/xCirno1/applyer/actions/workflows/ci.yml/badge.svg)](https://github.com/xCirno1/applyer/actions/workflows/ci.yml)
  [![Release](https://img.shields.io/github/v/release/xCirno1/applyer?display_name=tag)](https://github.com/xCirno1/applyer/releases/latest)
  [![License: MIT](https://img.shields.io/badge/license-MIT-2563eb.svg)](LICENSE)
  [![Electron 43](https://img.shields.io/badge/Electron-43-47848f?logo=electron&logoColor=white)](package.json)
  [![Security policy](https://img.shields.io/badge/security-policy-16a34a.svg)](SECURITY.md)

  [Download v1.0](https://github.com/xCirno1/applyer/releases/latest) ·
  [Security](SECURITY.md) ·
  [Contributing](CONTRIBUTING.md)
</div>

<br />

<div align="center">
  <a href="https://cdn.xcirno.dev/assets/applyer-demo.mp4">
    <img src="docs/screenshots/board.png" alt="Applyer job board and agent terminal — open the 36-second demo" width="920" />
  </a>
  <br />
  <sub><a href="https://cdn.xcirno.dev/assets/applyer-demo.mp4">▶ Watch the 36-second product tour</a></sub>
</div>

## One workspace, from search to review

Applyer pairs an embedded terminal with a live application board. Connect an
[MCP](https://modelcontextprotocol.io/)-capable CLI such as
[Claude Code](https://claude.com/product/claude-code) or
[Codex](https://github.com/openai/codex), describe the roles you want, and let the agent
research job sites, score matches, organize the pipeline, and prepare forms in a visible
browser. Final submission stays with you.

- **Search with context** across LinkedIn and Indeed, plus public Greenhouse, Lever,
  Ashby, and Workday boards.
- **Work from a real pipeline** with queued, filled, submitted, and failed states,
  exclusions, filters, bulk actions, notifications, and a searchable audit trail.
- **Draft multi-page applications** through inspected fields and permission-gated
  navigation. The agent cannot access a final-submit action.
- **Keep your workflow yours** with movable local storage, JSON/CSV import and export,
  custom appearance, keyboard shortcuts, and English or Indonesian UI.

## What changed in v1.0

The first public release brings cross-platform packages, complete optional data
encryption, company-board discovery, multi-step application inspection and editing,
explicit agent permissions, hardened import/export and IPC boundaries, and a release
pipeline that publishes SHA-256 checksums with every build. See the
[changelog](CHANGELOG.md) for the concise release record.

## Security and control

Trust is a product boundary, not a slogan:

- **Local-first data.** Applyer has no hosted account or application-data backend.
  Profiles, documents, job history, screenshots, and logs stay in the storage location
  you choose. Network traffic goes to job sites and to the provider used by your agent CLI.
- **Encryption you control.** Encrypted mode covers the SQLite database and files, with
  keys protected by the operating-system keychain. Plaintext mode remains an explicit
  choice. The recovery model is documented in [Encryption and local data](docs/encryption.md).
- **Bounded automation.** The MCP bridge exposes a small, validated tool surface. Form
  fields are inspected before editing, browser navigation requires permission, and no
  tool can submit an application. Your CLI's own filesystem and shell permissions remain
  governed by that CLI.
- **Auditable releases.** CI runs lint, type checks, tests, builds, and a high-severity
  dependency audit. Release artifacts are produced on native OS runners and published
  with `SHA256SUMS.txt`.
- **Responsible disclosure.** Please report security issues privately using the process
  in [SECURITY.md](SECURITY.md), not in a public issue.

## Install

Download the artifact for your operating system from
[GitHub Releases](https://github.com/xCirno1/applyer/releases/latest):

| Platform | Packages |
|---|---|
| Linux | AppImage, `.deb`, `.rpm` |
| macOS | `.dmg`, zipped `.app` |
| Windows | per-user NSIS installer, portable `.exe` |

You also need an installed and authenticated MCP-capable agent CLI. The first launch
guides you through your profile, documents, storage mode, and agent connection.

> **Release integrity:** v1.0 packages are not yet code-signed or notarized, so macOS and
> Windows may show an identity warning and Windows may scan the app on first launch.
> Verify your download against the release's `SHA256SUMS.txt`. Never install an Applyer
> binary obtained from an unofficial mirror.

### Run from source

Requires Node.js 20.19+ or 22.12+ and npm.

```bash
git clone https://github.com/xCirno1/applyer.git
cd applyer
npm install
npm run dev
```

`npm install` rebuilds the native Electron modules and installs Chromium for browser
automation. Development builds use a separate `applyer-dev` data directory, so they do
not touch an installed copy's data.

## How the agent connects

Applyer can configure Claude Code and Codex during onboarding, globally or only for
Applyer's workspace. Other MCP clients can use the generated configuration. The bridge
offers these capabilities:

| Area | MCP tools |
|---|---|
| Profile | `get_profile`, `update_profile` |
| Discovery | `search_jobs`, `get_job_details`, `add_company_board`, `list_company_boards` |
| Pipeline | `queue_job`, `list_jobs`, `flag_failure`, `exclude_job` |
| Application | `inspect_application`, `fill_application`, `edit_application`, `click_application_button` |

Every profile write and application action is visible in the Activity Log. Verification
challenges pause the workflow for you instead of being bypassed.

## Development

```bash
npm run typecheck           # main, preload, and renderer TypeScript
npm run lint                # ESLint
npm test                    # Vitest suite
npm run build               # production bundle
npm run smoke:mcp           # live MCP protocol smoke test
npm run test:site           # local browser-automation fixtures
npm run package             # package for this OS
npm run package:linux       # AppImage + deb + rpm
npm run package:mac         # dmg + zip (macOS host)
npm run package:win         # installer + portable exe
npm run package:all -- --dry-run
```

The `release-test` branch runs the complete Linux/macOS/Windows packaging matrix without
publishing. A version-matching tag such as `v1.0.0` publishes the checksummed artifacts as
a GitHub Release.

### Repository map

```text
src/main/       Electron lifecycle, storage, browser automation, MCP, IPC
src/preload/    context-isolated renderer bridge
src/renderer/   React 19 interface, state, themes, and localization
src/shared/     validated types, settings, and cross-process contracts
scripts/        migrations, smoke tests, and packaging pipeline
test/           shared mocks and local job-site fixtures
```

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md), follow the
[Code of Conduct](CODE_OF_CONDUCT.md), and use the issue templates for reproducible bug
reports or focused feature requests.

## License

[MIT](LICENSE) © 2026 xCirno1. Use, study, modify, and distribute Applyer with the license
notice included. The software is provided without warranty.
