# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow semver.

## [0.4.0] - 2026-11-13

First public release.

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
