# workflow-visualizer

**English** · [Español](./README.es.md)

A [Claude Code](https://claude.com/claude-code) plugin that turns agentic work into a live console.
Every agent a `Workflow` or `Agent` call launches shows up as a server in a rack next to the
orchestrator (your main session): a status LED, what it is doing right now in plain language, steps,
tool calls, tokens by kind and an estimated cost in USD, all updated as the model streams.
Select a server and you get its task, its latest actions with timestamps, the ADR, spec or ticket it
is working on, and its final report.

The same plugin bundles the `loop-mode` skill (a multi-ticket agentic loop over Jira/Linear tickets
with git worktrees, specs and verification gates) and turns the whole history into productivity
reports: tokens and cost by model, workflow, ticket and repo objective, plus sprint progress when
Jira is connected.

```
 🏟 WORKFLOW VISUALIZER rack · 4 servers        ⠹ 2 online · Σ agents 438.4k tok ≈ $0.87 · ←→↑↓ enter ?
 ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
 ║ 🎛 ORCHESTRATOR fable · turn 12                                                 ● WORK 00:41 ║
 ║ Role: launches agents and workflows, gathers their reports and answers you    ⎇ feat/ADR-006 ║
 ║ ▸ Launching workflow review-changes                                                          ║
 ║ 2 workflows · 9 agents · 2 online · context 23% · session $2.14 · ▂▃▅▆▇▅▃▂ 12.3k tok ≈ $0.31  ║
 ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
 ╭ 🐇 review:register  haiku ─────╮ ╭ 🦊 review:client  sonnet ──────╮ ╭ 🐉 review:types  fable ────────╮
 │ ● WORK 00:12 · step 3 · 4 tools│ │ ◉ THINK 00:09 · step 2 · 1 tool│ │ ● DONE 00:38 · step 5 · 6 tools│
 │ ▸ Reading hooks/register.tsx   │ │ ▸ Thinking…                    │ │ ▸ Delivered its report         │
 │   from line 101                │ │                                │ │                                │
 │ ▁▂▃▅▆ 43.6k tok $0.012         │ │ ▁▁▂▃ 29.0k tok $0.079          │ │ ▂▃▅▆▇ 97.0k tok $0.27          │
 ╰────────────────────────────────╯ ╰────────────────────────────────╯ ╰────────────────────────────────╯
```

## Install

In a Claude Code session:

```
/plugin install workflow-visualizer --marketplace giolabs/workflow-visualizer
```

Answer `y` to add the marketplace, then pick a scope (user is the usual one). You are then asked
once for the plugin's settings:

| Setting | Values | What it does |
| --- | --- | --- |
| Conversation language | `en`, `es` | Language of the pane, toasts, reports and the orchestration prompts. Code and docs stay in English. |
| Default decision mode | `hitl`, `autonomous` | `hitl` pauses loop runs before any push, PR or merge and asks; `autonomous` proceeds and reports every decision. |
| Jira project key | e.g. `MH` | Optional. Enables sprint metrics from the project's open sprint. |
| Jira story points field | `customfield_10016` | Optional. The custom field holding story points in your Jira. |
| Atlassian MCP server | `claude.ai Atlassian` | Optional. The MCP server name as `/mcp` lists it. |

Change any of them later in `/config` → workflow-visualizer. Jira is optional: without it, the
plugin still measures objectives from the artifacts in your repo (see below).

To run it from a checkout instead: `claude --plugin-dir /path/to/workflow-visualizer`.

## Commands

| Command | What it does |
| --- | --- |
| `/wv` | Opens the rack pane, focused (arrows, `Enter`, `?` work). |
| `/wv loop <tickets>` | Runs the bundled `loop-mode` orchestration over those tickets with the plugin's language and decision mode. |
| `/wv report [today\|7d\|30d\|all] [save]` | Productivity report in markdown; `save` writes it under `.workflow-visualizer/reports/`. |
| `/wv objectives [rescan]` | The repo's ADRs, specs, OpenSpec changes, GSD phases and local tickets with status and agent cost. |
| `/wv jira` | Jira connection status and the open sprint of the configured project. |
| `/wv help` | Subcommands and current settings. |

## In the pane

- `←→↑↓` or `hjkl` pick a server (the orchestrator is first); click works too.
- `Enter` opens or closes the detail of the selected server; `?` toggles the legend.
- LEDs: `WORK` using a tool · `THINK` reasoning · `WRITE` drafting · `BOOT` starting · `IDLE` waiting · `DONE` / `FAIL`.
- Header: live agent count, total agent tokens and the estimated USD across all agents.
- Orchestrator row: turn, role, current action, workflows and agents launched, context usage, the
  real session cost from `/cost`, its own tokens and estimate, and the current git branch.
- Detail: task, cache/in/out breakdown with a size rank (Ant → Beaver → Wolf → Elephant → Whale),
  current action, latest actions with timestamps, related tickets and repo objectives, final report.

Cost estimates use list prices per model (input, output, cache read, cache write at the 1-hour TTL
Claude Code uses) and are marked `≈`; the session figure is the engine's own.

## Objectives from your repo (no Jira needed)

The plugin scans the repository for the markdown artifacts teams keep, and links each agent to them
by the ids it mentions, the files it touches and the branch it runs on:

| Kind | Where it looks | Id and status |
| --- | --- | --- |
| ADR | `docs/adr`, `docs/decisions`, `docs/architecture/decisions`, `adr`, `conclave/product/adr` | `ADR-006`, `**Status**: accepted` |
| Spec | `docs/specs/*.md`, `docs/specs/<slug>/spec.md`, `specs/`, `.planning/specs` | `spec:<slug>`, `> **Estado:** DRAFT` or frontmatter `status:` |
| OpenSpec | `openspec/changes/<slug>/proposal.md`, `openspec/specs/<cap>/spec.md` | `openspec:<slug>`, `capability:<cap>` |
| GSD | `.planning/phases/*` | `phase:<n>`; `SUMMARY.md` → done, `PLAN.md` → in progress |
| Conclave | `conclave/sprints/*/stories`, `conclave/sprints/*/bugs`, `conclave/product/epics` | `US-023`, `BUG-003`, `EP-001`, frontmatter `status` |
| Local board | `scrum/tickets/*.md` | file id, frontmatter `status` |

Statuses normalize to open / active / done / dropped from the usual English and Spanish words.
The scan runs at session start, every few minutes when needed, and right after an agent writes
under one of those folders.

## Reports

`/wv report` aggregates every session the plugin has seen (kept in the plugin's store) plus the
live one:

- Summary: sessions, workflow runs, agents, success rate, tokens, estimated cost, average duration, tool calls.
- By model, by workflow (with run counts), by ticket (with Jira summary and status when available), by repo objective, by day.
- Repo objectives touched, with agents, tokens and cost; artifact counts by kind and status.
- Sprint objectives when a Jira project is configured: issues and points done vs. total, agent cost per sprint issue.
- The five most expensive agents.

## Jira (optional)

Jira goes through the Atlassian MCP connector. Authenticate once with `/mcp` → "claude.ai
Atlassian", then set the project key in `/config`. Agents that name a ticket (`MH-1234`) get its
summary, status, points and sprint in their detail; `/wv jira` and the report show the open sprint.
Linear support is on the roadmap.

## loop-mode

`skills/loop-mode/` ships the orchestration skill: ticket intelligence against Jira acceptance
criteria and dependency links, one git worktree and branch per ticket, a 20-section spec validated
before any code, phased implementation with real build/lint/test verification, FE/UI-aware model
choice, a run summary per ticket, and an optional PR-comment loop. `/wv loop <tickets>` starts it
with the plugin's language and decision mode already set; every decision reaches you as a multiple
choice question with a recommended option.

## Development

```
claude plugin validate .      # manifest, hooks and marketplace as the engine reads them
claude plugin test .          # 28 tests: hooks, UI, parsers, golden reports, edge cases
tests/e2e/objectives.sh       # headless check against real repos (spends tokens)
```

Type-check with `tsc -p .` once the engine has laid `.claude-plugin/types/` (it does on the first
load from `--plugin-dir`). Layout:

| Path | Role |
| --- | --- |
| `hooks/register.tsx` | the hooks: `agent.spawn`, `turn.*`, `tool.call`, `ui.render`, commands, `prompt.compose` |
| `hooks/rack-client.tsx` | the terminal UI (a `Client` surface module) |
| `hooks/i18n.ts` | every user-facing string, `en` and `es` |
| `hooks/describe.ts` | tool calls as one plain-language line |
| `hooks/pricing.ts` | list prices per model and the cost estimate |
| `hooks/history.ts` | persistence to `$.store`, aggregation and the markdown report |
| `hooks/objectives.ts` | repo artifact scan and agent ↔ objective matching |
| `hooks/jira.ts` | Atlassian MCP client with caching |
| `types/index.d.ts` | the `$.state` contract |
| `skills/loop-mode/` | the bundled orchestration skill |
| `tests/` | kit tests, golden fixtures, the E2E script |

See [CONTRIBUTING.md](./CONTRIBUTING.md). Licensed under [MIT](./LICENSE).
