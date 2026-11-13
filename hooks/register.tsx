import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { RackAgent, RackCatalog, RackPhase, RackRun, RackState, RackTicket } from '../types'
import { asLanguage, strings } from './i18n'
import type { Language, Strings } from './i18n'
import { HISTORY_PREFIX, aggregate, isTicketKey, parseWindow, renderReport, savedLine, ticketsOf, toHistory } from './history'
import { JiraUnavailable, PROJECT_KEY, cloudId, fetchIssue, fetchSprint, sprintTotals } from './jira'
import type { JiraConfig, JiraIssue, JiraSprint } from './jira'
import { matchObjectives, scanObjectives, summarize, touchesArtifacts } from './objectives'
import type { ObjectiveCatalog } from './objectives'
import type { HistorySession } from './history'
import { ASK_WORKFLOW_NAME, askWorkflowScript } from './ask-workflow'
import type { AskArgs } from './ask-workflow'
import { describeTool } from './describe'
import { VERSION } from './version'
import { usdOf } from './pricing'
import type { ClientAgent, ClientObjective, RackProps, SessionInfo } from './rack-client'
import { base, clip, str, workflowName } from './text'

const PLUGIN = 'workflow-visualizer'
const PANE = PLUGIN
const COMMAND = 'wv'
const SOLO = 'solo'
const MAIN = 'main'
const LOG_MAX = 14
const HISTORY_MAX = 16
const AGENTS_MAX = 60
const RUNS_MAX = 20
const FILES_MAX = 40
const CATALOG_TTL_MS = 5 * 60 * 1000

const EMPTY: RackState = { runs: [], agents: [], tickets: {} }

const rack = atom({ plugin: 'workflow-visualizer', key: 'rack' } as const, EMPTY, {
  shape: 'rack-3',
})
const tick = atom({ plugin: 'workflow-visualizer', key: 'tick' } as const, 0)

// Last phase written per loop: a thinking or text stream arrives in many
// chunks and only a change is worth a state write. Module-local on purpose.
const lastPhase = new Map<string, RackPhase>()

function mascot(model: string): string {
  const m = (model ?? '').toLowerCase()
  if (m.includes('haiku')) return '🐇'
  if (m.includes('sonnet')) return '🦊'
  if (m.includes('opus')) return '🦉'
  if (m.includes('fable')) return '🐉'
  return '🤖'
}

function fmtTok(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function totalOf(a: RackAgent): number {
  return a.input + a.output + a.cacheRead + a.cacheWrite
}

function isLive(a: RackAgent): boolean {
  return a.status === 'running' || a.status === 'spawning'
}

/** Caps the list, dropping the oldest finished agents first and never a live one. */
function capAgents(list: RackAgent[]): RackAgent[] {
  if (list.length <= AGENTS_MAX) return list
  let drop = list.length - AGENTS_MAX

  return list.filter(a => {
    if (!isLive(a) && drop > 0) {
      drop--

      return false
    }

    return true
  })
}

/** Caps the list, dropping the oldest ended runs first and never one still open. */
function capRuns(list: RackRun[]): RackRun[] {
  if (list.length <= RUNS_MAX) return list
  let drop = list.length - RUNS_MAX

  return list.filter(r => {
    if (r.endedAt !== undefined && drop > 0) {
      drop--

      return false
    }

    return true
  })
}

function freshMain(now: number, model: string, t: Strings): RackAgent {
  return {
    id: MAIN,
    runKey: MAIN,
    index: 0,
    description: t.orchestratorName,
    task: t.orchestratorRole,
    type: 'main',
    model,
    status: 'idle',
    phase: 'off',
    startedAt: now,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    steps: 0,
    tools: 0,
    turns: 0,
    doing: t.waitingForYou,
    log: [{ at: now, text: t.sessionStarted }],
    history: [],
    files: [],
  }
}

/** Applies `fn` to the loop `id` names: the orchestrator or one agent. */
/** A tile for an agent whose spawn this plugin did not see (a skill run in a subagent, an agent started before the plugin loaded). */
function adopted(id: string, now: number, model: string, info: { description: string; type: string; parentId?: string } | undefined, prompt: string, t: Strings): RackAgent {
  const type = info?.type ?? 'agent'

  return {
    id,
    runKey: SOLO,
    index: 0,
    parentId: info?.parentId,
    description: clip(info?.description || prompt || type, 200),
    task: clip(prompt, 600),
    type,
    model,
    status: 'running',
    phase: 'thinking',
    startedAt: now,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    steps: 0,
    tools: 0,
    turns: 1,
    doing: t.readingYourMessage,
    log: [{ at: now, text: t.adoptedAs(type) }],
    history: [],
    files: [],
  }
}

function touch(
  s: RackState,
  id: string,
  now: number,
  model: string | undefined,
  t: Strings,
  fn: (a: RackAgent) => RackAgent,
): RackState {
  if (id === MAIN) return { ...s, main: fn(s.main ?? freshMain(now, model ?? '', t)) }

  return { ...s, agents: s.agents.map(a => (a.id === id ? fn(a) : a)) }
}

function logged(a: RackAgent, at: number, text: string): RackAgent {
  const last = a.log[a.log.length - 1]
  if (last && last.text === text) return a

  return { ...a, log: [...a.log, { at, text }].slice(-LOG_MAX) }
}

function toClient(a: RackAgent, runName: string, catalog: ObjectiveCatalog | undefined): ClientAgent {
  return {
    id: a.id,
    runKey: a.runKey,
    runName,
    index: a.index,
    parentId: a.parentId ?? null,
    description: a.description,
    task: a.task,
    type: a.type,
    model: a.model,
    status: a.status,
    phase: a.phase,
    startedAt: a.startedAt,
    endedAt: a.endedAt ?? null,
    input: a.input,
    output: a.output,
    cacheRead: a.cacheRead,
    cacheWrite: a.cacheWrite,
    steps: a.steps,
    tools: a.tools,
    turns: a.turns,
    doing: a.doing,
    log: a.log,
    history: a.history,
    answer: a.answer ?? null,
    usd: usdOf(a),
    files: a.files,
    objectives: catalog ? matchObjectives(catalog, a) : [],
  }
}

/** The text `/wv loop <tickets>` hands the model: run the bundled skill under the plugin's settings. */
function loopPrompt(args: string, language: Language, autonomy: string): string {
  const lang = language === 'es' ? 'Spanish (rioplatense)' : 'English'

  return [
    `Invoke the \`loop-mode\` skill (bundled by the workflow-visualizer plugin) with these arguments: ${args || '(none given: ask for the ticket set first)'}.`,
    `Settings fixed by the plugin, do not ask for them again: orchestrator language = ${lang} (skip the skill's Step 0); decision mode = ${autonomy === 'autonomous' ? 'autonomous (proceed through push/PR and report every decision taken)' : 'human-in-the-loop (pause before any push, PR, merge or dependency override and ask)'}.`,
    'Every question to the user goes through AskUserQuestion with 2-4 options, the recommended one first and marked "(Recommended)", each with a one-line reason. Never ask in prose.',
    'The Workflow Visualizer pane is open and shows every agent live; keep status lines terse.',
  ].join('\n')
}

const SUBCOMMANDS = ['loop', 'report', 'objectives', 'jira', 'help', 'config'] as const
type Subcommand = (typeof SUBCOMMANDS)[number] | 'open' | 'ask' | 'unknown'

/** Edit distance, for forgiving a typo in a subcommand (`objetives`, `cofig`). */
function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] ?? 0
      prev[j] = Math.min((prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }

  return prev[b.length] ?? 0
}

/** What the first word after /wv means: a subcommand, a near miss of one, free text for the model, or nothing. */
function resolveSubcommand(first: string, hasMore: boolean): { sub: Subcommand; corrected: boolean } {
  const word = first.toLowerCase()
  if (word === '') return { sub: 'open', corrected: false }
  if ((SUBCOMMANDS as readonly string[]).includes(word)) return { sub: word as Subcommand, corrected: false }
  if (['settings', 'configuracion', 'configuración', 'ajustes', 'ayuda'].includes(word)) return { sub: word === 'ayuda' ? 'help' : 'config', corrected: true }
  const near = SUBCOMMANDS.find(s => distance(word, s) <= Math.max(1, Math.floor(s.length / 3)))
  if (near) return { sub: near, corrected: true }
  // One lone word that is no subcommand is a typo to report; several words are a request in plain words.
  return { sub: hasMore ? 'ask' : 'unknown', corrected: false }
}

/** The exact Workflow call the orchestrator makes for a /wv request, and what to do with its result. */
function launchPrompt(request: string, language: Language, askArgs: AskArgs): string {
  const lang = language === 'es' ? 'Spanish (rioplatense)' : 'English'
  const scriptLines = ['Workflow input `script` (verbatim):', '```js', askWorkflowScript().trim(), '```']

  return [
    `The user typed \`/wv ${request}\` to the workflow-visualizer plugin. That slash command is their explicit opt-in to multi-agent orchestration: call the Workflow tool NOW, before anything else, with exactly these inputs:`,
    '',
    ...scriptLines,
    '',
    `Workflow input \`args\` (JSON, pass as an object): ${JSON.stringify(askArgs)}`,
    '',
    `Then say in one line, in ${lang}, that the \`${ASK_WORKFLOW_NAME}\` research is running and visible in the rack. Do not investigate yourself and do not start loop-mode. When the workflow's task notification arrives, present the synthesizer's answer as it is, in ${lang}, keeping its citations; if it ends with numbered options, ask them through AskUserQuestion with the recommended one first. If a source was unavailable (for example Jira not authenticated), say so and point to /mcp for Jira.`,
  ].join('\n')
}

/** A free-text request after /wv, handed to the model with the visualizer's context. */
function askPrompt(request: string, language: Language): string {
  const lang = language === 'es' ? 'Spanish (rioplatense)' : 'English'

  return [
    `The user typed this request to the Workflow Visualizer plugin: "${request}"`,
    'Answer it using the plugin\'s own data and commands first: run /wv objectives for the repository\'s ADRs, specs, OpenSpec changes, GSD phases and local tickets (ids, status, agent cost); /wv report for productivity by model/workflow/ticket; /wv jira for the open sprint; the rack pane for live agents. For Jira issues linked to an ADR, epic or key, use the Atlassian MCP tools (searchJiraIssuesUsingJql, getJiraIssue) when they are available, else say Jira is not connected (/mcp → claude.ai Atlassian).',
    `Reply in ${lang}. Every decision that is the user's goes through AskUserQuestion with 2-4 options, the recommended one first and marked "(Recommended)", each with a one-line reason; never ask in prose. Do not start a loop-mode run from this request; that is /wv loop <tickets>.`,
  ].join('\n')
}

function helpText(t: Strings, language: Language, autonomy: string): string {
  const lines =
    language === 'es'
      ? [
          `${t.versionLine(VERSION)} — subcomandos:`,
          '/wv            abre el pane del rack',
          '/wv loop <tickets>   corre la orquestación loop-mode sobre esos tickets (Jira/Linear)',
          '/wv report [today|7d|30d|all] [save]   reporte de productividad (tokens, costo, por modelo/workflow/ticket, sprint)',
          '/wv jira       estado de la conexión con Jira y el sprint abierto del proyecto configurado',
          '/wv objectives [rescan]   ADR, specs, OpenSpec, GSD y tickets locales del repo, con estado y costo de agentes',
          '/wv help       esta ayuda',
          '/wv <pedido en palabras>   lanza el workflow wv-ask (repo + Jira + git → síntesis) y lo muestra en el rack (p. ej. "/wv tickets del ADR-050 en backlog")',
          `Config: idioma=${language}, modo=${autonomy}. Cambialos en /config → workflow-visualizer (también /wv config).`,
        ]
      : [
          `${t.versionLine(VERSION)} — subcommands:`,
          '/wv            open the rack pane',
          '/wv loop <tickets>   run the loop-mode orchestration over those tickets (Jira/Linear)',
          '/wv report [today|7d|30d|all] [save]   productivity report (tokens, cost, by model/workflow/ticket, sprint)',
          '/wv jira       Jira connection status and the open sprint of the configured project',
          '/wv objectives [rescan]   the repo\'s ADRs, specs, OpenSpec changes, GSD phases and local tickets, with status and agent cost',
          '/wv help       this help',
          '/wv <request in plain words>   launches the wv-ask workflow (repo + Jira + git → synthesis) and shows it in the rack (e.g. "/wv tickets of ADR-050 in backlog")',
          `Config: language=${language}, mode=${autonomy}. Change them in /config → workflow-visualizer (also /wv config).`,
        ]

  return lines.join('\n')
}

function toTicket(i: JiraIssue): RackTicket {
  return {
    key: i.key,
    summary: i.summary,
    status: i.status,
    category: i.category,
    type: i.type,
    assignee: i.assignee,
    points: i.points,
    sprint: i.sprint,
    url: i.url,
    fetchedAt: i.fetchedAt,
  }
}

// Issues already asked for this load: one fetch per key per TTL, whatever the agents repeat.
const asked = new Map<string, number>()

function jiraStatus(language: Language, cfg: JiraConfig, sprint: JiraSprint | null, error: string | null): string {
  const es = language === 'es'
  const lines = [
    es ? `Jira vía MCP "${cfg.server}"` : `Jira via MCP "${cfg.server}"`,
    es ? `proyecto: ${cfg.project || '(sin configurar: /config → workflow-visualizer → Jira project key)'}` : `project: ${cfg.project || '(not set: /config → workflow-visualizer → Jira project key)'}`,
  ]
  if (error) lines.push(es ? `estado: no disponible — ${error}` : `status: unavailable — ${error}`, es ? 'Autenticá con /mcp → "claude.ai Atlassian" y volvé a probar.' : 'Authenticate with /mcp → "claude.ai Atlassian" and retry.')
  else if (sprint) {
    const t = sprintTotals(sprint)
    lines.push(
      es ? `sprint abierto: ${sprint.name ?? '?'} · issues ${t.done}/${t.issues} cerrados · puntos ${t.pointsDone}/${t.points}` : `open sprint: ${sprint.name ?? '?'} · issues ${t.done}/${t.issues} done · points ${t.pointsDone}/${t.points}`,
    )
    for (const i of sprint.issues.slice(0, 15)) lines.push(`  ${i.key}  ${i.status.padEnd(14)} ${i.points === null ? '  -' : String(i.points).padStart(3)}  ${i.summary.slice(0, 60)}`)
    if (sprint.issues.length > 15) lines.push(`  … ${sprint.issues.length - 15} ${es ? 'más' : 'more'}`)
  } else lines.push(es ? 'estado: conectado' : 'status: connected')

  return lines.join('\n')
}

type EnrichDollar = Pick<EngineInterface, 'mcp' | 'store' | 'state'>

/** Looks the keys up in Jira in the background and lands them in the rack; silent when Jira is unavailable. */
function enrich($: EnrichDollar, cfg: JiraConfig, keys: string[], now: number): void {
  const fresh = keys.filter(k => (asked.get(k) ?? 0) + 10 * 60 * 1000 < now)
  if (fresh.length === 0) return
  for (const k of fresh) asked.set(k, now)
  void (async () => {
    for (const key of fresh) {
      try {
        const issue = await fetchIssue($, cfg, key, now)
        if (issue) await update($, rack, s => ({ ...s, tickets: { ...s.tickets, [key]: toTicket(issue) } }))
      } catch (err) {
        // Jira is off, unauthenticated or answered with a shape we do not know: the key stays bare in the rack.
        if (err instanceof JiraUnavailable) break
        break
      }
    }
  })()
}

type ScanDollar = Pick<EngineInterface, 'fs' | 'process' | 'session' | 'state' | 'clock'>

/** Scans the repo's ADR/spec/OpenSpec/GSD/ticket artifacts and the current branch into the rack; cached for a while. */
// One scan at a time: a burst of Write/Edit calls under artifact folders coalesces into the
// scan in flight plus one trailing rescan, instead of one full scan per call.
let scanInFlight: Promise<RackCatalog | undefined> | null = null
/**
 * Starts a model turn with the plugin's prompt, set by session.start. The engine refuses
 * `$.prompt.submit` from inside `command.run` (that hook holds the turn the submit would
 * wait on), so the submit runs in a timer callback under the session's `$`, after the
 * command answered. Fire and forget: a refusal is reported as a toast.
 */
let launchTurn: ((text: string, context: readonly string[], onRefused: string) => void) | null = null
let scanPending = false

async function refreshCatalog($: ScanDollar, force = false): Promise<RackCatalog | undefined> {
  if (scanInFlight) {
    scanPending = scanPending || force

    return scanInFlight
  }
  scanInFlight = scanOnce($, force).finally(() => {
    scanInFlight = null
    if (scanPending) {
      scanPending = false
      void refreshCatalog($, true).catch(() => undefined)
    }
  })

  return scanInFlight
}

async function scanOnce($: ScanDollar, force: boolean): Promise<RackCatalog | undefined> {
  const now = await $.clock.now()
  const current = (await read($, rack)).objectives
  if (!force && current && now - current.scannedAt < CATALOG_TTL_MS) return current
  const repo = await $.session.repo().catch(() => null)
  const root = repo?.root ?? (await $.session.cwd())
  let branch: string | null = null
  try {
    const ran = await $.process.run(['git', '-C', root, 'branch', '--show-current'], { timeoutMs: 3000 })
    branch = ran.stdout.trim() || null
  } catch {
    // not a git repo, or git missing: objectives still scan, branch matching is off
  }
  const catalog = await scanObjectives($, root, branch, now)
  await update($, rack, s => ({ ...s, objectives: catalog }))

  return catalog
}

const RANK: Record<string, number> = { active: 0, open: 1, unknown: 2, done: 3, dropped: 4 }

function objectivesText(language: Language, catalog: RackCatalog | undefined, cost: Map<string, number>): string {
  const es = language === 'es'
  if (!catalog) return es ? 'Todavía no se escaneó el repo.' : 'Repo not scanned yet.'
  if (catalog.items.length === 0) return es ? `Sin artefactos de objetivos en ${catalog.root} (ADR, specs, openspec/, .planning/, conclave/, scrum/).` : `No objective artifacts in ${catalog.root} (ADR, specs, openspec/, .planning/, conclave/, scrum/).`
  const lines = [`${catalog.root}${catalog.branch ? ` ⎇ ${catalog.branch}` : ''}`, '']
  const sum = summarize(catalog)
  for (const [kind, b] of Object.entries(sum)) lines.push(`${kind.padEnd(16)} ${String(b.total).padStart(3)}  ${es ? 'abiertos' : 'open'} ${b.open} · ${es ? 'activos' : 'active'} ${b.active} · ${es ? 'cerrados' : 'done'} ${b.done}${b.dropped ? ` · ${es ? 'descartados' : 'dropped'} ${b.dropped}` : ''}`)
  lines.push('')
  const items = [...catalog.items].sort((x, y) => (RANK[x.phase] ?? 2) - (RANK[y.phase] ?? 2) || x.id.localeCompare(y.id))
  for (const o of items.slice(0, 40)) {
    const usd = cost.get(o.id)
    lines.push(`${o.phase === 'done' ? '✔' : o.phase === 'active' ? '●' : o.phase === 'dropped' ? '✖' : '○'} ${o.id.padEnd(24)} ${o.status.padEnd(12)} ${o.title.slice(0, 60)}${usd !== undefined ? `  ≈$${usd.toFixed(2)}` : ''}`)
  }
  if (items.length > 40) lines.push(`… ${items.length - 40} ${es ? 'más' : 'more'}`)

  return lines.join('\n')
}

function isHistory(v: unknown): v is HistorySession {
  return typeof v === 'object' && v !== null && Array.isArray((v as HistorySession).agents) && typeof (v as HistorySession).sessionId === 'string'
}

type StoreDollar = { store: { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<void>; keys: () => Promise<string[]> } }
type SessionDollar = { session: { id: () => Promise<string>; cwd: () => Promise<string>; repo: () => Promise<{ root: string } | null>; usage: () => Promise<{ startedAt: number }> }; clock: { now: () => Promise<number> } }

/** Writes this session's finished agents and runs to `$.store` under `history:<sessionId>`. */
async function persist($: StoreDollar & SessionDollar, state: RackState): Promise<HistorySession> {
  const [sessionId, cwd, repo, now] = await Promise.all([$.session.id(), $.session.cwd(), $.session.repo().catch(() => null), $.clock.now()])
  let startedAt = now
  try {
    startedAt = (await $.session.usage()).startedAt
  } catch {
    // no usage ledger: the first persist stamps the start
  }
  const key = `${HISTORY_PREFIX}${sessionId}`
  const previous = await $.store.get(key)
  const catalog = state.objectives
  const record = toHistory(state, { sessionId, cwd, repo: repo?.root ?? null, startedAt, now }, usdOf, isHistory(previous) ? previous : undefined, a => (catalog ? matchObjectives(catalog, a).map(m => m.id) : []))
  await $.store.set(key, record)

  return record
}

/** Every stored session plus the live one, for a report. */
async function allHistory($: StoreDollar & SessionDollar, state: RackState): Promise<HistorySession[]> {
  const live = await persist($, state)
  const keys = (await $.store.keys()).filter(k => k.startsWith(HISTORY_PREFIX) && k !== `${HISTORY_PREFIX}${live.sessionId}`)
  const stored = await Promise.all(keys.map(k => $.store.get(k)))

  return [...stored.filter(isHistory), live]
}

export const register: Register = (on, options) => {
  const language = asLanguage(options.language)
  const autonomy = options.autonomy === 'autonomous' ? 'autonomous' : 'hitl'
  const t = strings(language)
  const jira: JiraConfig = {
    server: typeof options.jiraServer === 'string' && options.jiraServer ? options.jiraServer : 'claude.ai Atlassian',
    project: typeof options.jiraProject === 'string' && PROJECT_KEY.test(options.jiraProject.trim().toUpperCase()) ? options.jiraProject.trim().toUpperCase() : '',
    pointsField: typeof options.jiraPointsField === 'string' && options.jiraPointsField ? options.jiraPointsField : 'customfield_10016',
  }

  on('session.start', async ($, e, next) => {
    launchTurn = (text, context, onRefused) => {
      $.clock.after(0, () => {
        // The long instructions (the whole wv-ask script among them) go in as a hidden user row the
        // model reads and the person never sees; the prompt that starts the turn is one line.
        void Promise.all(context.map(block => $.session.append({ message: { type: 'user', content: [{ type: 'text', text: block }] } })))
          .then(() => $.prompt.submit({ text }))
          .then(entered => ('drop' in entered ? $.ui.toast(`${onRefused} ${String(entered.drop)}`) : undefined))
          .catch((err: unknown) => $.ui.toast(`${onRefused} ${err instanceof Error ? err.message : String(err)}`))
      })
    }
    await $.command.register({
      name: COMMAND,
      description: t.commandOpen,
      argumentHint: t.commandHint,
    })

    void refreshCatalog($, true).catch(() => undefined)

    $.clock.every(1000, () => {
      void (async () => {
        const state = await read($, rack)
        const live = state.agents.some(isLive) || state.main?.status === 'running'
        if (live) await update($, tick, n => n + 1)
      })()
    })

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const lang = language === 'es' ? 'Spanish (rioplatense, voseo)' : 'English'
    const text = [
      '# Workflow Visualizer',
      `The workflow-visualizer plugin is active. Converse with the user in ${lang}; keep code, commits, file names and docs in English unless the project says otherwise.`,
      'Whenever a decision is the user\'s to make, ask it with AskUserQuestion: 2-4 options, the recommended one first and labeled "(Recommended)", each with a one-line reason. Never leave a question in prose.',
      `Loop runs default to ${autonomy === 'autonomous' ? 'autonomous mode' : 'human-in-the-loop mode'} ("/wv loop <tickets>"); the user can switch it per run.`,
    ].join('\n')

    return { sections: [...composed.sections, { id: 'workflow-visualizer', text, scope: 'session' }] }
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    try {
    const args = e.args.trim()
    const [first = '', ...restRaw] = args.split(/\s+/)
    const resolved = resolveSubcommand(first, restRaw.length > 0)
    const sub = resolved.sub
    const rest = restRaw
    const note = resolved.corrected ? ` ${t.interpretedAs(sub)}` : ''
    if (sub === 'loop') {
      const seat = await $.ui.open({ id: PANE, title: t.paneTitle, focus: true })
      const seatNote = seat.isPlaced ? '' : `\n${t.paneWaiting(seat.reason)}`
      const prompt = loopPrompt(rest.join(' '), language, autonomy)
      if (!launchTurn) return { text: `${t.loopStarting(rest.join(' '))}${note}${seatNote}`, context: [prompt] }
      launchTurn(`${t.loopStarting(rest.join(' '))} (/wv loop)`, [prompt], t.launchRefused)

      return { text: `${t.loopStarting(rest.join(' '))}${note}${seatNote}`, isTextDisplayOnly: true }
    }
    if (sub === 'help') return { text: helpText(t, language, autonomy), isTextDisplayOnly: true }
    if (sub === 'config') return { text: t.configHint, isTextDisplayOnly: true }
    if (sub === 'ask') {
      // The engine does not let a plugin call the Workflow tool itself (its agents run outside the
      // bound on plugin spawns), so the launch is handed to the orchestrator as an exact instruction:
      // the user's /wv is the opt-in, the script travels verbatim and the request only in args.
      const repo = await $.session.repo().catch(() => null)
      const askArgs: AskArgs = { request: args, language, repoRoot: repo?.root ?? (await $.session.cwd()), jiraProject: jira.project, jiraServer: jira.server }
      // The user asked for this run: seat the pane now, with focus, instead of waiting for the Workflow call.
      const seat = await $.ui.open({ id: PANE, title: t.paneTitle, focus: true })
      const seatNote = seat.isPlaced ? '' : `\n${t.paneWaiting(seat.reason)}`
      // The script travels verbatim in the hidden context: a file under the repo could be swapped
      // or symlinked between the write and the Workflow run, and the engine would execute it.
      const prompt = launchPrompt(args, language, askArgs)
      if (!launchTurn) return { text: `${t.askLaunched(clip(args, 80))}${seatNote}`, context: [prompt] }
      launchTurn(`${t.askLaunched(clip(args, 80))} (/wv)`, [prompt], t.launchRefused)

      return { text: `${t.askLaunched(clip(args, 80))}${seatNote}`, isTextDisplayOnly: true }
    }
    if (sub === 'unknown') return { text: t.unknownSubcommand(first), isTextDisplayOnly: true }
    if (sub === 'objectives') {
      const catalog = await refreshCatalog($, rest.includes('rescan'))
      const state = await read($, rack)
      const now = await $.clock.now()
      const sessions = await allHistory($, state)
      const agg = aggregate(sessions, 'all', now)
      const cost = new Map(agg.byObjective.map(([id, b]) => [id, b.usd]))

      return { text: `${objectivesText(language, catalog, cost)}${note}`, isTextDisplayOnly: true }
    }
    if (sub === 'jira') {
      const now = await $.clock.now()
      let sprint: JiraSprint | null = null
      let error: string | null = null
      try {
        if (jira.project) sprint = await fetchSprint($, jira, now)
        else await cloudId($, jira)
      } catch (err) {
        if (!(err instanceof JiraUnavailable)) throw err
        error = err.message
      }

      return { text: jiraStatus(language, jira, sprint, error), isTextDisplayOnly: true }
    }
    if (sub === 'report') {
      const state = await read($, rack)
      const now = await $.clock.now()
      const sessions = await allHistory($, state)
      const window = parseWindow(rest.find(w => w !== 'save'))
      const catalog = (await refreshCatalog($).catch(() => undefined)) ?? null
      const agg = aggregate(sessions, window, now)
      const tickets: Record<string, { summary: string; status: string }> = {}
      let sprint: JiraSprint | null = null
      let sprintError: string | undefined
      for (const [key] of agg.byTicket) {
        if (!isTicketKey(key)) continue
        const known = state.tickets[key]
        if (known) tickets[key] = { summary: known.summary, status: known.status }
        else {
          try {
            const issue = await fetchIssue($, jira, key, now)
            if (issue) tickets[key] = { summary: issue.summary, status: issue.status }
          } catch (err) {
            if (!(err instanceof JiraUnavailable)) throw err
            break
          }
        }
      }
      if (jira.project) {
        try {
          sprint = await fetchSprint($, jira, now)
        } catch (err) {
          if (!(err instanceof JiraUnavailable)) throw err
          sprintError = err.message
        }
      }
      const md = renderReport(agg, language, { tickets, sprint, sprintProject: jira.project || undefined, sprintError, catalog })
      if (rest.includes('save')) {
        const cwd = await $.session.cwd()
        const stamp = new Date(now).toISOString().slice(0, 16).replace(/[:T]/g, '-')
        const path = `${cwd}/.workflow-visualizer/reports/report-${window}-${stamp}.md`
        try {
          await $.fs.write(path, md)

          return { text: `${md}\n\n${savedLine(language, path)}`, isTextDisplayOnly: true }
        } catch (err) {
          return { text: `${md}\n\n(${String(err)})`, isTextDisplayOnly: true }
        }
      }

      return { text: md, isTextDisplayOnly: true }
    }
    await $.ui.open({ id: PANE, title: t.paneTitle, focus: true })

    return { text: t.paneOpened, isTextDisplayOnly: true }
    } catch (err) {
      // A malformed store record or an unexpected MCP shape degrades to a message, never a failed command.
      return { text: `workflow-visualizer: ${err instanceof Error ? err.message : String(err)}`, isTextDisplayOnly: true }
    }
  })

  on('tool.call', { tool: 'Workflow' }, async ($, e, next) => {
    const now = await $.clock.now()
    const run: RackRun = {
      key: e.tool_use_id,
      name: workflowName(e.script, e.name, t.defaultRun),
      startedAt: now,
    }
    await update($, rack, s => ({ ...s, runs: capRuns([...s.runs, run]) }))
    void $.ui.open({ id: PANE, title: t.paneTitle })
    $.ui.toast(t.workflowEnters(run.name))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('agent.spawn', async ($, e, next) => {
    const now = await $.clock.now()
    const started = await next(e)
    if (started.deny !== undefined || started.agentId === undefined) return started

    const runKey = e.workflow ? e.tool_use_id : SOLO
    void $.ui.open({ id: PANE, title: t.paneTitle })
    const agent: RackAgent = {
      id: started.agentId,
      runKey,
      index: e.workflow?.agentIndex ?? 0,
      parentId: e.parentAgentId,
      description: clip(e.description || e.subagentType, 200),
      task: clip(e.prompt, 600),
      type: e.subagentType,
      model: started.model,
      status: 'spawning',
      phase: 'boot',
      startedAt: now,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      steps: 0,
      tools: 0,
      turns: 0,
      doing: t.booting,
      log: [{ at: now, text: t.bootedAs(e.subagentType) }],
      history: [],
      files: [],
    }
    lastPhase.set(agent.id, 'boot')
    const spawner = e.parentAgentId ?? MAIN
    const note = t.launched(mascot(agent.model), clip(agent.description, 40))
    await update($, rack, s => {
      let runs = s.runs.map(r =>
        r.key === runKey && e.workflow && r.runId === undefined ? { ...r, runId: e.workflow.runId } : r,
      )
      if (e.workflow && !runs.some(r => r.key === runKey)) {
        // A run whose Workflow call this plugin did not see (a resumed or server-launched run).
        runs = capRuns([...runs, { key: runKey, runId: e.workflow.runId, name: t.defaultRun, startedAt: now }])
      }
      const hasSolo = runs.some(r => r.key === SOLO)
      const withSolo =
        runKey === SOLO && !hasSolo ? [...runs, { key: SOLO, name: t.soloRun, startedAt: now }] : runs
      const merged: RackState = {
        ...s,
        runs: withSolo,
        agents: capAgents([...s.agents.filter(a => a.id !== agent.id), agent]),
      }

      return touch(merged, spawner, now, e.parentModel, t, a => logged(a, now, note))
    })
    enrich($, jira, ticketsOf(agent.description, agent.task), now)

    return started
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    const model = await $.session.model()
    lastPhase.set(id, 'boot')
    const known = id === MAIN || (await read($, rack)).agents.some(a => a.id === id)
    if (!known) {
      // A subagent the spawn hook never saw (a skill running in a subagent, a spawn before the plugin
      // loaded): give it a tile from what the engine lists, so every running agent shows in the rack.
      const info = (await $.agent.list().catch(() => [])).find(a => a.id === id)
      const tile = adopted(id, now, model, info, e.text, t)
      void $.ui.open({ id: PANE, title: t.paneTitle })
      await update($, rack, s => {
        const runs = s.runs.some(r => r.key === SOLO) ? s.runs : [...s.runs, { key: SOLO, name: t.soloRun, startedAt: now }]

        return { ...s, runs, agents: capAgents([...s.agents.filter(a => a.id !== id), tile]) }
      })
      enrich($, jira, ticketsOf(tile.description, tile.task), now)

      return next(e)
    }
    await update($, rack, s =>
      touch(s, id, now, model, t, a => {
        if (id === MAIN) {
          const text = e.text ? t.turnLabel(a.turns + 1, clip(e.text, 50)) : t.turnContinued(a.turns + 1)

          return logged(
            {
              ...a,
              status: 'running',
              phase: 'thinking',
              startedAt: now,
              endedAt: undefined,
              turns: a.turns + 1,
              doing: t.readingYourMessage,
            },
            now,
            text,
          )
        }

        return a.status === 'spawning' ? { ...a, status: 'running' } : a
      }),
    )

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? MAIN
    const model = e.model
    const now0 = await $.clock.now()
    await update($, rack, s =>
      touch(s, id, now0, model, t, a => ({
        ...a,
        status: a.status === 'done' || a.status === 'failed' ? a.status : 'running',
        steps: a.steps + 1,
      })),
    )
    const setPhase = async (phase: RackPhase, doing: string) => {
      if (lastPhase.get(id) === phase) return
      lastPhase.set(id, phase)
      const now = await $.clock.now()
      await update($, rack, s =>
        touch(s, id, now, model, t, a =>
          a.status === 'done' || a.status === 'failed' ? a : logged({ ...a, phase, doing }, now, doing),
        ),
      )
    }
    for await (const chunk of next(e)) {
      if (chunk.kind === 'thinking') await setPhase('thinking', t.thinking)
      else if (chunk.kind === 'text') await setPhase('writing', id === MAIN ? t.writingAnswerMain : t.writingAnswerAgent)
      else if (chunk.kind === 'stop' && chunk.usage) {
        const u = chunk.usage
        const now = await $.clock.now()
        await update($, rack, s =>
          touch(s, id, now, model, t, a => ({
            ...a,
            model: u.model || a.model,
            input: a.input + u.input_tokens,
            output: a.output + u.output_tokens,
            cacheRead: a.cacheRead + u.cache_read_input_tokens,
            cacheWrite: a.cacheWrite + u.cache_creation_input_tokens,
            history: [...a.history, u.output_tokens + u.input_tokens].slice(-HISTORY_MAX),
          })),
        )
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const text = describeTool(e.tool, e as unknown as Record<string, unknown>, t)
    const now = await $.clock.now()
    const model = await $.session.model()
    lastPhase.set(id, 'tool')
    const input = e as unknown as Record<string, unknown>
    const toolName: string = e.tool
    const file = str(input.file_path) ?? str(input.filePath) ?? (toolName === 'Grep' || toolName === 'Glob' ? undefined : str(input.path))
    await update($, rack, s =>
      touch(s, id, now, model, t, a =>
        logged({ ...a, phase: 'tool', tools: a.tools + 1, doing: text, files: file && !a.files.includes(file) ? [...a.files, file].slice(-FILES_MAX) : a.files }, now, text),
      ),
    )
    const ran = await next(e)
    if (file && (e.tool === 'Write' || e.tool === 'Edit') && touchesArtifacts(file)) void refreshCatalog($, true).catch(() => undefined)

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId ?? MAIN
    const now = await $.clock.now()
    const model = await $.session.model()
    const ok = e.reason === 'answer'
    const usage = e.usage
    lastPhase.delete(id)

    if (id === MAIN) {
      const closing = ok ? t.answeredYou : e.isAborted ? t.turnAborted : t.turnError(e.reason)
      await update($, rack, s =>
        touch(s, id, now, model, t, a =>
          logged(
            {
              ...a,
              status: 'idle',
              phase: 'off',
              endedAt: now,
              doing: t.waitingForYou,
              answer: e.answer ? clip(e.answer, 700) : a.answer,
            },
            now,
            closing,
          ),
        ),
      )

      return next(e)
    }

    const closing = ok ? t.deliveredReport : t.endedWithError(e.reason)
    const state = await update($, rack, s =>
      touch(s, id, now, model, t, a =>
        logged(
          {
            ...a,
            status: ok ? 'done' : 'failed',
            phase: 'off',
            endedAt: now,
            doing: closing,
            answer: e.answer ? clip(e.answer, 700) : undefined,
            ...(usage
              ? {
                  model: usage.model || a.model,
                  input: usage.input_tokens,
                  output: usage.output_tokens,
                  cacheRead: usage.cache_read_input_tokens,
                  cacheWrite: usage.cache_creation_input_tokens,
                }
              : {}),
          },
          now,
          closing,
        ),
      ),
    )
    const done = state.agents.find(a => a.id === id)
    if (done) {
      $.ui.toast(t.agentFinished(mascot(done.model), clip(done.description, 80), ok, fmtDur(now - done.startedAt), fmtTok(totalOf(done))))
      const live = state.agents.filter(isLive)
      $.ui.status(live.length > 0 ? t.statusLine(live.length) : undefined)
      const runLeft = state.agents.some(a => a.runKey === done.runKey && isLive(a))
      if (!runLeft && done.runKey !== SOLO) {
        await update($, rack, s => ({
          ...s,
          runs: s.runs.map(r => (r.key === done.runKey ? { ...r, endedAt: now } : r)),
        }))
      }
      const spawner = done.parentId ?? MAIN
      const report = (ok ? t.received : t.failedChild)(mascot(done.model), clip(done.description, 40))
      const after = await update($, rack, s => touch(s, spawner, now, model, t, a => logged(a, now, report)))
      await persist($, after).catch(() => undefined)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, rack)
    await read($, tick)
    const now = await $.clock.now()
    const sessionModel = await $.session.model()
    let contextPct: number | null = null
    let costUsd: number | null = null
    try {
      const usage = await $.session.usage()
      contextPct = usage.context.percent ?? null
      costUsd = usage.cost?.usd ?? null
    } catch {
      // the host keeps no figures: the panel says so
    }
    const runName = (key: string) => state.runs.find(r => r.key === key)?.name ?? t.defaultRun
    const catalog = state.objectives
    const agents = state.agents.map(a => toClient(a, runName(a.runKey), catalog))
    const main = toClient(state.main ?? freshMain(now, sessionModel, t), t.sessionRun, catalog)
    // Only what the tiles can show goes to the Client: the objectives and tickets some agent names
    // (the whole catalog of a large repo serialises past the engine's 100k-character bound on props).
    const named = new Set<string>()
    for (const a of [main, ...agents]) for (const m of a.objectives) named.add(m.id)
    const objectives: Record<string, ClientObjective> = {}
    for (const o of catalog?.items ?? []) if (named.has(o.id)) objectives[o.id] = { id: o.id, kind: o.kind, title: clip(o.title, 80), status: o.status, phase: o.phase }
    const mentioned = new Set<string>()
    for (const a of [main, ...agents]) for (const key of Object.keys(state.tickets)) if (a.description.includes(key) || a.task.includes(key)) mentioned.add(key)
    const tickets: Record<string, RackTicket> = {}
    for (const key of mentioned) tickets[key] = state.tickets[key]!
    const session: SessionInfo = {
      contextPct,
      costUsd,
      workflows: state.runs.filter(r => r.key !== SOLO).length,
      agents: state.agents.length,
      live: state.agents.filter(isLive).length,
      agentsTokens: state.agents.reduce((n, a) => n + totalOf(a), 0),
      agentsUsd: state.agents.reduce((n, a) => n + (usdOf(a) ?? 0), 0),
      unpriced: state.agents.filter(a => usdOf(a) === null).length,
    }
    const rows = Math.max(8, e.props.scroll.bodyRows)

    if (e.surface === 'terminal' || e.surface === 'desktop') {
      const { Box, Client } = $.ui.resolve(e)
      const props: RackProps = { now, language, main, agents, session, tickets, objectives, branch: catalog?.branch ?? null }

      return (
        <Box flexDirection="column">
          <Client key="rack" module="./rack-client.tsx" props={props} width="100%" height={rows} />
        </Box>
      )
    }

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Text bold color="claude">
          🏟 {t.paneTitle.toUpperCase()}
        </Text>
        <Text>
          🎛 {main.description} · {main.doing} · {fmtTok(main.input + main.output + main.cacheRead + main.cacheWrite)} tok
        </Text>
        {agents.length === 0 && <Text dimColor>{t.emptyTitle}</Text>}
        {agents.slice(-Math.max(1, rows - 3)).map(a => {
          const live = a.status === 'running' || a.status === 'spawning'
          const tot = a.input + a.output + a.cacheRead + a.cacheWrite

          return (
            <Text dimColor={!live}>
              {live ? '●' : a.status === 'done' ? '✔' : '✖'} {mascot(a.model)} {a.description} · {a.doing} ·{' '}
              {fmtTok(tot)} tok · {fmtDur((a.endedAt ?? now) - a.startedAt)}
            </Text>
          )
        })}
      </Box>
    )
  })
}
