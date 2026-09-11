# Contributing to Applyer

Thanks for taking a look — contributions, bug reports, and ideas are all welcome.

## Getting set up

```bash
npm install   # also rebuilds native modules (better-sqlite3, node-pty) for Electron
              # and downloads a bundled Chromium for the agent's browser automation
npm run dev   # launches the app in development mode
```

See the [README](README.md) for prerequisites and a walkthrough of how the app works.

## Before you open a PR

```bash
npm run typecheck
npm run lint
npm run test        # unit test suite (Vitest)
npm run smoke:mcp   # exercises the MCP server end to end against a running dev instance
npm run test:site   # local job forms for manual fill/CAPTCHA/failure testing
```

All four should pass clean. `npm run test` covers logic and data (job-source parsing,
MCP schemas/tools, database repositories, encryption, config/CLI adapters, renderer
preference logic and state stores) — it does not cover rendered React components yet, so
UI changes still need manual verification through the app (see the README's "Is it ready
to use?" section for the current coverage bar).

For browser-automation and notification changes, `npm run test:site` starts a loopback-only
fixture site at `http://127.0.0.1:8765`. Its index links to fillable, partially supported,
verification-blocked, redirect, and failure cases; see `test/fixtures/job-site/README.md`
for the expected outcomes and end-to-end flow.

When adding logic worth testing, prefer a black-box style: exercise the module's real
exported behavior with real inputs (mocking only genuine boundaries — network, a CLI
subprocess, Electron/OS APIs) rather than mocking the module's own internals. See
`test/mocks/electron.ts` and `src/main/db/testDb.ts` for the shared Electron mock and the
real-migrations SQLite test-database helper most repository/tool tests build on.

## Making changes

- Keep PRs focused — one feature or fix per PR is easier to review than a bundle.
- Follow the existing code organization: reusable UI in `src/renderer/src/components/`
  (see [its own guidelines](src/renderer/src/components/CLAUDE.md) for where new
  components belong), MCP tools in `src/main/mcp-server/tools/`, IPC handlers in
  `src/main/ipc/`.
- Match the design conventions already in the codebase (dense controls, 1px seams over
  shadows, rectangle buttons, no icon backgrounds — see `CLAUDE.md` for the full list) if
  your change touches UI.
- Never assume incoming data (job postings, scraped HTML, agent tool calls) is
  well-formed — validate it and fail into a visible error state rather than crashing.

## Translations

The UI is translated with [i18next](https://www.i18next.com/). Catalogs are plain JSON
under `src/renderer/src/i18n/locales/<locale>/`, split into namespaces that mirror the
app's structure (`common`, `board`, `settings`, `onboarding`, `indexedJobs`, `workspace`,
`errors`).

**English (`en`) is the source of truth.** Every `t()` call is type-checked against it, so
adding a string means adding it to the English catalog first. `npm run typecheck` fails on
a key that doesn't exist there.

### Adding a language

1. Copy `locales/en/` to `locales/<your-locale>/` and translate the values (leave the keys
   alone).
2. Register it in `src/renderer/src/i18n/locale.ts` (`SUPPORTED_LOCALES`) with its name in
   its own script, since someone stuck in a language they can't read needs to recognise theirs.
3. Import the namespaces in `src/renderer/src/i18n/config.ts`.
4. Run `npm test`. `i18n/catalogs.test.ts` checks your catalog against English.

You don't have to translate everything. Missing keys fall back to English, so a partial
translation still ships and still works.

### Things the tests will hold you to

- **Don't rename keys or invent new ones.** An extra key is always a bug (a typo, or a
  leftover after an English key was renamed).
- **Keep `{{placeholders}}` exactly as they appear in English.** A dropped `{{count}}`
  leaves a hole in the sentence; a typo'd one renders literal braces.
- **Use your language's real plural forms**, not English's. i18next selects them via
  `Intl.PluralRules`: a key like `retryMessage` needs `_one`/`_other` in English but only
  `_other` in Indonesian, and needs `_one`/`_few`/`_many`/`_other` in Polish. Providing a
  form your language never selects is dead weight, and the tests flag it.

### Things that are deliberately *not* translated

- **Agent-facing text**: `src/main/config/agentInstructions.ts` and the MCP tool
  descriptions in `src/main/mcp-server/tools/`. Those are read by an LLM, not a person, and
  translating them measurably degrades tool use.
- **Job data**: titles, companies, and descriptions come from the postings themselves.
- **Main-process errors.** The main process has no locale, and its errors also reach the
  logs and export bundles. Handlers return `{ code, params }` (see
  `src/shared/types/errorCodes.ts`) and the renderer turns that into a sentence via the
  `errors` namespace. If you add an error, add the code *and* an English string. A
  compile-time check in `i18n/formatError.ts` enforces the pair.

### Right-to-left

Not supported yet. The layout uses physical direction classes (`pl-`, `mr-`, `text-left`),
so an RTL locale needs those converted to logical properties (`ps-`, `me-`, `text-start`)
first. Please open an issue before starting that, since it's a cross-cutting change.

## Reporting bugs / requesting features

Open a [GitHub issue](https://github.com/xCirno1/applyer/issues) with as much detail as
you can — steps to reproduce, what you expected, what happened instead, and your OS
(this has mainly been built and tested on Linux so far, so platform-specific reports are
especially useful).

## Code of conduct

This project follows the [Code of Conduct](CODE_OF_CONDUCT.md) — please read it before
participating.
