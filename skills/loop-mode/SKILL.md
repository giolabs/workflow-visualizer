---
name: loop-mode
description: Autonomous multi-ticket agentic loop — checks each ticket's real Jira acceptance criteria and dependency links (flags blockers) first, then one git worktree+branch per ticket, Opus for research/verification and Sonnet for implementation, a 20-section spec verified against real code, a PASS/WARN/BLOCK validation gate, phased implementation with real build/lint/test verification, FE/UI-aware (Figma/design/image reference, latest Opus or Fable 5 for UI tickets), a run-summary per ticket, and an optional recurring PR-comment loop with human-in-the-loop decisions. Use when the user wants several related tickets from one epic built in parallel, hands over Jira/Linear keys to implement concurrently, says "loop-mode", "modo loop", "implementemos estos tickets en paralelo con worktrees", "orquestá el épico X", or wants an autonomous loop with HITL checkpoints. Orchestration specialist, not a harness configurator — never edits settings.json/hooks/CLAUDE.md. Requires Workflow and a git repo.
---

# loop-mode

An autonomous agentic loop over N tickets from one epic: investigate first, spec before any code,
one git worktree + branch per ticket, FE/UI-aware, paused before any push/PR until the user says
otherwise, with an optional recurring loop that watches PR comments after tickets ship.

**The point of this whole pattern:** eliminate gray areas. A gray area is anything the loop would
otherwise guess at silently — a Jira dependency nobody checked, an acceptance criterion nobody
read, a design convention nobody looked up, a "should pass" nobody actually ran. Every step below
exists to close one specific gray area before implementation starts, not after.

**Scope boundary.** This skill is a specialist in producing an autonomous agentic loop with
human-in-the-loop (HITL) checkpoints where genuinely needed. It does not superimpose itself on the
project's own harness configuration — it never edits `settings.json`, hooks, or `CLAUDE.md`; it
reads and follows them, the same as any other work in this repo would.

This skill is heavyweight by design — it spawns real worktrees and multiple agents per ticket.
Only run it when the user has actually asked for parallel multi-ticket implementation, not for a
single ticket or a quick fix.

## Step 0 — Orchestrator language and decision mode (from the plugin, never asked again)

This skill ships inside the **workflow-visualizer** plugin, which asked the user once, at install,
for the conversation language (`language`: `en` or `es`) and the default decision mode
(`autonomy`: `hitl` or `autonomous`). `/wv loop <tickets>` hands you both. Use them; do not ask
for either. They govern how *you* (the orchestrator) talk to the user and whether the run pauses
before any push, PR, merge or dependency override (`hitl`) or proceeds and reports each decision
taken (`autonomous`). They do not change spec language (Step 6 follows the project's own spec
corpus), commit messages, or subagent-internal prompts, nor PR description language (Step 9).

The user may switch the mode for one run with the first option dialog of the run; the plugin's
setting stays the default. Every question to the user, in any step, is an AskUserQuestion with 2-4
options, the recommended one first and labeled "(Recommended)", each with a one-line reason. Never
ask in prose.

## Step 1 — Gather ticket inputs (always ask what's missing)

Four inputs are non-negotiable. Do not infer or guess any of them — ask via AskUserQuestion if the
user's message didn't already supply them. Every past rebase collision this pattern hit traced
back to skipping one of these four.

1. **Ticket set** — the N ticket keys with a one-line scope each. If the user only named an epic,
   look it up (Jira MCP if available) rather than asking them to retype what's already tracked.
2. **Dependency graph** — which tickets are independent vs. which extend/mount inside another. Get
   this explicit even if it seems obvious — it drives worktree base-branches and merge order. Step
   2 cross-checks this against Jira's own data, so treat this as the user's starting belief, not
   the final word.
3. **File-ownership map** — for any file more than one ticket might touch (shared barrels,
   registries, shared constants/catalogs), assign a single owner ticket. If the user isn't sure,
   grep the repo for files each ticket's scope would plausibly touch and flag overlaps for them to
   assign rather than assigning it yourself.
4. **Push/PR policy** — follows the decision mode from Step 0: under `hitl` nothing gets pushed or
   opened as a PR until the user gives explicit go-ahead, ticket by ticket or as a batch; under
   `autonomous` the run pushes and opens PRs itself and reports every decision it took.

Things you *can* infer without asking (state your inference so the user can correct it): base
branch (usually `develop` or `main`), the verification command (check root `package.json` /
`CLAUDE.md`), worktree root (default `.claude/worktrees/`), branch naming (default
`feat/{ticket}-{slug}`).

## Step 2 — Ticket intelligence pass

Before locking in anything from Step 1's dependency graph, read `references/ticket-intelligence.md`
and follow it: spawn one read-only research subagent per ticket, in parallel, to pull the real
acceptance criteria/Definition of Done from Jira, check Jira's own issue links for blockers (in
**any** status, not just an obvious "blocked" one), cross-check those against the user's declared
graph, and run a fast codebase-fit probe for obvious "this ticket's premise doesn't hold here"
smells.

Reconcile everything the reports surface through the decision protocol (Step 7) **before** Step 5's
layering runs — a Jira blocker the user's graph missed, a declared dependency Jira doesn't
corroborate, or a blocker still in progress all need a conscious call, not a silent override in
either direction. No findings means proceed with the user's original graph unchanged.

## Step 3 — Model orchestration

Ask the user (multiple choice, AskUserQuestion) which models to assign to the two roles in this
pipeline. Lead with the scheme that's proven for this pattern, marked as the recommendation, but
let them override — some repos or budgets call for something else:

- **Research/verification** (ticket intelligence, spec generation, the spec-validation gate) →
  recommend the most capable Opus model currently available.
- **Implementation** (writing code, running verification, committing) → recommend Sonnet.

Offer options like: "Opus for research+verification / Sonnet for implementation (recommended)",
"Same tier for everything — ask which", "Custom — I'll specify per role". Resolve whatever they
pick into a concrete `models: { spec, validate, implement }` map — this feeds `args.models` in
Step 6's Workflow call.

## Step 4 — FE/UI detection

Scan each ticket's scope/AC (now enriched by Step 2) for FE/UI signals: `[FE]` tags, mentions of
screens/views/components/pages, "design", "Figma", "mockup", "UI", "layout", or a scope that
touches a frontend app path directly. For every flagged ticket, follow
`references/fe-ui-detection.md` — in short:

1. Ask whether the user wants to attach a **Figma link**, a **Claude/Figma design reference** (via
   the Figma MCP if connected), or an **image**, with "skip / no visual reference" as a valid
   option.
2. Ask a second question recommending the **latest available Opus model, or Fable 5**, for that
   ticket's spec+implementation stages — visual fidelity benefits from the strongest model more
   than most backend-only phases. Let the user override.
3. Record, per FE ticket: `isFE: true`, `feModel`, and `designRef`. These flow into
   `args.tickets[]` in Step 6.

FE tickets carry a hard requirement baked into their prompts regardless of the above: read the
project's `CLAUDE.md` (and any nested one, e.g. `apps/web/CLAUDE.md`) and inspect `DESIGN.md` or
whatever design-system source the project actually has before writing any UI code.

## Step 5 — Topological layering

Sort the tickets into dependency layers using the graph reconciled in Step 2: layer 0 is every
ticket with no dependency, layer 1 depends only on layer-0 tickets, and so on. Do this reasoning
yourself — don't delegate it to an agent. A dependent ticket's worktree must branch off its
parent's *finished* branch, which is only possible if each layer runs after the previous one
produced real commits.

## Step 6 — Per-layer Workflow invocation

For each layer, call the `Workflow` tool with `scriptPath` pointing at
`references/loop-mode-workflow.js`, and `args` shaped like:

```js
{
  repoPath: "/absolute/path/to/the/target/repo", // REQUIRED — see guardrails below
  tickets: [
    {
      key: "MH-1234", slug: "ambient-view", scope: "...",
      acceptanceCriteria: [...], definitionOfDone: [...],   // from Step 2
      baseBranch: "develop",              // layer-0 only
      parentBranch: "feat/MH-1200-shell", // dependent tickets only — the PARENT'S branch name
      isFE: true, feModel: "opus",        // from Step 4, omit entirely for non-FE tickets
      designRef: { type: "figma", value: "https://figma.com/..." },
    },
  ],
  fileOwnership: [{ file: "apps/web/domains/copilot/index.ts", owner: "MH-1234" }],
  models: { spec: "opus", validate: "opus", implement: "sonnet" }, // from Step 3
  baseBranch: "develop",
  verifyCommand: "pnpm run build && pnpm run lint && pnpm run test",
  appPath: "apps/web",
  worktreeRoot: ".claude/worktrees",
  branchPrefix: "feat/",
  maxFilesPerPhase: 5,
}
```

Spec generation inside the script follows the canonical 20-section template
(`references/spec-template.md`) and validation returns a PASS / PASS_WITH_WARNINGS / BLOCK verdict
capped at 3 fix-and-revalidate cycles before escalating — same as this repo's own `/generate-spec`
skill, so a loop-mode spec is indistinguishable in structure from a manually-run one. The script
never pushes or opens PRs — that stays with you, per Step 9, even on a clean run.

## Step 7 — Decision protocol (applies to every escalation, here and in Step 10)

Read `references/decision-protocol.md` in full before the first escalation of a run — it also
carries the four Karpathy guardrails (verifiable success, surfaced assumptions, simplicity,
surgical changes) that govern every subagent's behavior, not just what reaches the user. In short:
every decision handed to the user is **multiple choice** via AskUserQuestion, and you must have
already researched the codebase/Jira/ADRs/`CLAUDE.md` enough to include your own recommendation as
one of the options, clearly labeled — never hand the user an unresearched shrug of options. This
applies to ticket-intelligence mismatches (Step 2), spec-validation blockers, implementation
blockers, rebase conflicts, and PR-comment findings (Step 10) alike.

## Step 8 — Run summary per finished goal

When a ticket reaches a terminal state (done or blocked) in the Workflow's return value, write a
markdown run summary using `references/run-summary-template.md` to
`{worktreePath}/docs/specs/{ticket}/run-report.md`. This is the artifact this loop pattern leaves
behind per goal — ticket-intelligence findings, orchestrator decisions, subagents spawned
(label/model/phase/verdict), gaps/blockers with confidence scores, spec-validation verdict history
(including any fix-and-revalidate cycles), and the model assignments used for that ticket.

## Step 9 — Push / PR (only when the user lifts the pause)

Never automatic, regardless of how clean a layer looks. When the user explicitly says to proceed:

1. Push each ticket's branch, in dependency/merge order (layer 0 first).
2. Build the PR the way this repo already expects: if the `generate-pr` skill is available, invoke
   it per ticket — it already detects `.github/pull_request_template.md` / review rules and does
   the self-review. Only if no such convention exists anywhere in the repo, fall back to
   `references/pr-template-fallback.md`.
3. Leave final approval to the user or the named reviewer — never self-approve.

## Step 10 — Optional: PR-comment monitoring loop

After PRs are open, ask the user (multiple choice) whether they want continuous monitoring of PR
comments as they land. If yes, read `references/pr-comment-loop.md` and follow it — in short: use
the `/loop` skill to drive a recurring check against the open PRs; each firing spawns one subagent
per *new* comment to identify who/what is commenting (bot vs. human, and which bot), judge whether
it carries real architectural value, and whether it flags a regression against the shipped diff.
Anything substantive gets escalated to you, the orchestrator, and you take it to the user through
the same decision protocol as Step 7.

## Communication discipline

Only you, the orchestrator, talk to the user. Subagent output stays internal — you read it,
extract what matters, and report it in the language set in Step 0. Format status updates like a
technical console log, not prose: concise, prefixed by ticket key and stage, explicit about state
transitions — e.g. `MH-1234 [Implement] phase 2/3 verify: FAIL exit 1 — 3 test failures in
copilot.spec.ts`. No filler, no "great news!" — this is operational status, not customer-facing
copy.

## Guardrails carried over from prior runs of this pattern

- One grep is never enough for a rename or contract check — direct references, type references,
  string literals, barrel exports, and DI tokens, checked separately.
- Prefer `rebase` over `merge` when stacking a dependent ticket's branch onto its parent.
- Every finding that asserts something about existing code carries a confidence score — enforced
  in the workflow script's schemas, and the same standard applies to anything you say directly to
  the user.
- "Should pass" is never acceptable evidence — the workflow script re-runs the real verification
  command and only commits on an actual zero exit code.
- Every agent in the pipeline verifies its own claims before reporting them (spec file existence,
  real `git status --short` output, not memory of intent) — a phase with zero real changes or more
  than `maxFilesPerPhase` changed files is blocked, never silently committed.
- Before relaunching anything after a session interruption, check real git state first
  (`git worktree list`, `git -C <worktree> status`) and check `/workflows` for a still-active run
  before starting a duplicate.
- **Always pass `args.repoPath` as an absolute path to the Workflow call in Step 6.** A subagent
  spawned by `Workflow` does not reliably inherit the orchestrator's working directory — a dry run
  of this exact skill once created real worktrees and branches inside the wrong repo because
  nothing pinned the target repo explicitly, and it only surfaced because the run was checked
  before trusting it. `loop-mode-workflow.js` now refuses to run without `repoPath` and anchors
  every git command to it with `-C` — never edit that requirement away to save a line in `args`.
- After any Workflow-based run against a real repo (dry run or not), verify with `git worktree
  list` and `git status` that only the expected worktrees/branches exist before reporting success
  — this is the same "verify before claiming" discipline applied to yourself, not just the agents.
