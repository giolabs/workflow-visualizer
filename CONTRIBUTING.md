# Contributing

**English** · [Español](./CONTRIBUTING.es.md)

Thanks for helping. This is a Claude Code plugin of function hooks: a TypeScript module the engine
loads, with a terminal UI drawn by a `Client` surface module. No Node, no DOM: everything outside
the module goes through `$`.

## Set up

1. Clone the repository and start a session with the plugin loaded from disk:
   ```
   claude --plugin-dir /path/to/workflow-visualizer
   ```
   The engine lays the API typings under `.claude-plugin/types/` on that first load (git-ignored).
2. In that session, `/wv` opens the pane. Edits to the plugin hot-reload when the turn ends.
3. Before opening a pull request:
   ```
   claude plugin validate .
   claude plugin test .
   tsc -p .
   ```
   All three must pass. `tests/e2e/objectives.sh` is optional and spends tokens.

## Rules of the house

- **Code, file names, commits and docs in English.** User-facing strings live in `hooks/i18n.ts`
  with an `en` and an `es` entry each; the UI never hard-codes a sentence. Both READMEs change together.
- **Decisions reach the user as questions with options.** Anything the plugin or the bundled skill
  asks goes through `AskUserQuestion`-style dialogs with a recommended option, never a prose question.
- **Every hook that gates a tool or a spawn carries `.catch(($, e, next) => next(e))`** so a bug in
  the plugin never blocks the session. `claude plugin validate` lists the gating hooks.
- **State changes bump the shape.** `$.state` outlives a reload; when `RackState` changes, bump the
  `shape` tag on the `rack` atom so old values are declined rather than misread.
- **Prices are data.** Update `hooks/pricing.ts` from the official price list; estimates stay marked `≈`.
- **Tests are the spec.** New parsing (status words, artifact layouts, tool descriptions) comes
  with a row in `tests/parsers.test.ts`. A report change regenerates `tests/golden.ts` with
  `tests/e2e/gen-golden.mjs` and says so in the PR.

## Adding an artifact convention

`hooks/objectives.ts` holds `SOURCES` (where each kind lives), the status word lists and `idFor`.
Add the pattern, a header sample from a real repo to `tests/parsers.test.ts`, and a line to the
"Objectives from your repo" table in both READMEs.

## Reporting a bug

Use the issue template. Include the Claude Code version (`claude --version`), the plugin version
from `plugin.json`, your terminal and its width, and the dim `workflow-visualizer: …` line the
transcript prints when a hook fails.

## Commits and releases

Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`). Commits are authored by the person
driving the change, with `Co-Authored-By:` lines for anyone (or any model) that co-wrote it.

Releases are tag-driven:

1. Add a `## [<version>] - <date>` section to `CHANGELOG.md` (move items out of `[Unreleased]`).
2. On a clean, synced `main`, run `scripts/release.sh <version>`: it bumps
   `.claude-plugin/plugin.json`, commits `release: v<version>`, tags `v<version>` and pushes.
3. The `release` GitHub workflow validates and tests the plugin, takes the CHANGELOG section as
   release notes and publishes the GitHub release. A version with a suffix (`0.5.0-beta.1`,
   `0.5.0-rc.1`) is published as a **pre-release**; betas are how a version is tried before it is
   declared stable.

Users install a specific version with
`/plugin install workflow-visualizer@<version> --marketplace giolabs/workflow-visualizer`.
