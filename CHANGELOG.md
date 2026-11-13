# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow semver.
Pre-releases (`-beta.N`, `-rc.N`) are for trying a version before it is declared stable.

## [Unreleased]

### Added
- `/wv <request in plain words>` launches the plugin's own `wv-ask` Workflow: three research
  agents in parallel (repository artifacts, Jira through the Atlassian MCP, git history) and a
  synthesizer that answers in the configured language. The command hands the orchestrator the exact
  Workflow call (script verbatim, the request only in `args`); the run shows in the rack and the
  orchestrator relays the synthesis.
- `/wv help` shows the plugin version (`hooks/version.ts`, bumped by `scripts/release.sh`).

### Fixed
- Restored the `/wv` dispatcher fix that beta.2 missed: `loop` and plain-word requests reach the
  model as hidden context instead of being printed; typos are corrected; `config` points to `/config`.

### Changed
- Releases are prepared as a pull request (`scripts/release.sh` bumps the version and stamps the
  CHANGELOG section on a `release/v<version>` branch) and tagged after the merge with
  `scripts/tag-release.sh`; a ruleset on `main` requires pull requests and blocks force pushes.

## [0.4.0-beta.2] - 2026-11-13

Second public beta: the security-audit fixes and a usable `/wv` dispatcher.

### Fixed
- `/wv loop <tickets>` and plain-word requests after `/wv` are delivered to the orchestrator as
  hidden context instead of being printed as the command's output; typos in subcommands are
  corrected by edit distance (`objetives` → `objectives`), `/wv config` points to `/config`, and a
  lone unknown word is reported with a pointer to `/wv help`.

### Security
- `statusOf` parses the status from one bounded line with bounded whitespace classes: a crafted
  ADR/spec with `**Status**` followed by a long whitespace run no longer backtracks cubically and
  stalls the scan (security audit run-1, confirmed low).
- Repo scan skips symlinked entries and names with separators or control characters, and caps the
  catalog at 500 artifacts; rescans triggered by Write/Edit coalesce into one in-flight scan.
- Text from agents, tools, Jira and repo headings is stripped of control, bidi-override and
  zero-width characters before it reaches the pane, toasts or reports; markdown table cells escape
  `|` and line breaks.
- `jiraProject` must match a project key and is quoted in the JQL; cached Jira records are
  shape-checked; a missing issue no longer stops the enrichment of the other keys.
- `/wv report` re-validates ticket keys read from the store before any MCP call; `/wv jira` probes
  connectivity with the resources tool instead of a fake issue lookup.
- `turn.start`/`turn.complete` fail open like the other hooks; a failing `/wv` subcommand
  returns a message instead of failing the command.
- loop-mode workflow: `repoPath`/`worktreeRoot` must be absolute paths without shell
  metacharacters; `tickets[].scope`, `designRef.value` and `fileOwnership` go through
  `untrusted()` like AC/DoD; a setup agent reporting a different worktree path blocks the ticket
  instead of redirecting later git lines; `maxFilesPerPhase` must be a positive integer.
- loop-mode skill: PR-comment-driven changes require an AskUserQuestion in both decision modes and
  comment bodies are wrapped as untrusted data; the run never merges in any mode.
- Release workflow split into a read-only `verify` job (no persisted credentials, tag must be
  reachable from `main`, pinned actions and CLI) and a `publish` job that runs no repository code;
  an existing release is never overwritten.

## [0.4.0-beta.1] - 2026-11-13

First public beta. Try it, open issues; the API, state shape and report layout may still move
before 0.4.0.

### Added
- Rack pane: the orchestrator and every agent as server tiles with status LED, plain-language
  current action, steps, tool calls, token sparkline, tokens and estimated USD; detail panel with
  task, latest actions, related tickets and objectives, and final report.
- Keyboard and pointer navigation in the pane; English and Spanish UI chosen once at install.
- `/wv`, `/wv help`, `/wv loop <tickets>`, `/wv report [window] [save]`, `/wv objectives [rescan]`, `/wv jira`.
- Persistence of every session's agents and runs in the plugin store; productivity report by model,
  workflow, ticket, repo objective and day, with the most expensive agents.
- Repo objectives: ADRs, specs, OpenSpec changes and capabilities, GSD phases, Conclave stories,
  bugs and epics, and local board tickets, matched to agents by id, slug, touched files and branch.
- Optional Jira integration through the Atlassian MCP: ticket enrichment and open-sprint objectives.
- Bundled `loop-mode` skill driven by the plugin's language and decision mode (`hitl` / `autonomous`).
- Cost estimates at list price per model, cache write at the 1-hour TTL.
- 28 kit tests (hooks, UI, parsers, golden reports, edge cases) and a headless E2E script.
- Tag-driven releases: `scripts/release.sh` and the `release` GitHub workflow.

### Security
- The bundled `loop-mode` workflow validates ticket keys, slugs and branch names before any git
  command, writes commit messages through a file instead of a shell line, and hands Jira text to
  agents as JSON-encoded untrusted data; autonomous runs show the ticket text to the user first.
