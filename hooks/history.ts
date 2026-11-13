import type { RackAgent, RackRun, RackState } from '../types'
import type { Language } from './i18n'
import type { JiraSprint } from './jira'
import { sprintTotals } from './jira'
import type { ObjectiveCatalog } from './objectives'
import { summarize } from './objectives'
import { sanitize } from './text'

/** What one session leaves in `$.store` under `history:<sessionId>`. */
export type HistoryAgent = {
  id: string
  runKey: string
  runName: string
  description: string
  type: string
  model: string
  status: 'done' | 'failed'
  startedAt: number
  endedAt: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  steps: number
  tools: number
  usd: number | null
  tickets: string[]
  objectives: string[]
}

export type HistoryRun = {
  key: string
  name: string
  startedAt: number
  endedAt: number | null
  agents: number
}

export type HistorySession = {
  sessionId: string
  cwd: string
  repo: string | null
  startedAt: number
  updatedAt: number
  runs: HistoryRun[]
  agents: HistoryAgent[]
}

export const HISTORY_PREFIX = 'history:'
const SESSION_AGENTS_MAX = 400

const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g

/** Jira/Linear-looking keys in a text (`MH-1234`, `ENG-42`), unique, in order. */
/** True when `key` is exactly one Jira/Linear-looking key, the shape ticketsOf extracts. */
export function isTicketKey(key: string): boolean {
  return /^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/.test(key)
}

export function ticketsOf(...texts: string[]): string[] {
  const out: string[] = []
  for (const text of texts) {
    for (const hit of text.matchAll(TICKET)) if (!out.includes(hit[0])) out.push(hit[0])
  }

  return out
}

export function toHistory(
  state: RackState,
  meta: { sessionId: string; cwd: string; repo: string | null; startedAt: number; now: number },
  usdOf: (a: RackAgent) => number | null,
  previous: HistorySession | undefined,
  objectivesOf: (a: RackAgent) => string[] = () => [],
): HistorySession {
  const runName = (key: string) => state.runs.find(r => r.key === key)?.name ?? key
  const finished = state.agents.filter((a): a is RackAgent & { endedAt: number } => a.endedAt !== undefined)
  const fresh: HistoryAgent[] = finished.map(a => ({
    id: a.id,
    runKey: a.runKey,
    runName: runName(a.runKey),
    description: a.description,
    type: a.type,
    model: a.model,
    status: a.status === 'failed' ? 'failed' : 'done',
    startedAt: a.startedAt,
    endedAt: a.endedAt,
    input: a.input,
    output: a.output,
    cacheRead: a.cacheRead,
    cacheWrite: a.cacheWrite,
    steps: a.steps,
    tools: a.tools,
    usd: usdOf(a),
    tickets: ticketsOf(a.description, a.task),
    objectives: objectivesOf(a),
  }))
  // Agents the live state already dropped (its cap) stay from the previous record.
  const kept = (previous?.agents ?? []).filter(p => !fresh.some(f => f.id === p.id))
  const agents = [...kept, ...fresh].slice(-SESSION_AGENTS_MAX)
  const runs: HistoryRun[] = state.runs.map((r: RackRun) => ({
    key: r.key,
    name: r.name,
    startedAt: r.startedAt,
    endedAt: r.endedAt ?? null,
    agents: agents.filter(a => a.runKey === r.key).length,
  }))
  const keptRuns = (previous?.runs ?? []).filter(p => !runs.some(r => r.key === p.key))

  return {
    sessionId: meta.sessionId,
    cwd: meta.cwd,
    repo: meta.repo,
    startedAt: previous?.startedAt ?? meta.startedAt,
    updatedAt: meta.now,
    runs: [...keptRuns, ...runs],
    agents,
  }
}

export type Window = 'today' | '7d' | '30d' | 'all'

export function parseWindow(arg: string | undefined): Window {
  if (arg === 'today' || arg === '7d' || arg === '30d' || arg === 'all') return arg

  return '7d'
}

function windowStart(window: Window, now: number): number {
  const day = 24 * 60 * 60 * 1000
  if (window === 'today') return now - (now % day)
  if (window === '7d') return now - 7 * day
  if (window === '30d') return now - 30 * day

  return 0
}

type Bucket = {
  agents: number
  done: number
  failed: number
  tokens: number
  usd: number
  unpriced: number
  durationMs: number
  tools: number
}

function bucket(): Bucket {
  return { agents: 0, done: 0, failed: 0, tokens: 0, usd: 0, unpriced: 0, durationMs: 0, tools: 0 }
}

function add(b: Bucket, a: HistoryAgent): void {
  b.agents++
  if (a.status === 'done') b.done++
  else b.failed++
  b.tokens += a.input + a.output + a.cacheRead + a.cacheWrite
  if (a.usd === null || a.usd === undefined) b.unpriced++
  else b.usd += a.usd
  b.durationMs += a.endedAt - a.startedAt
  b.tools += a.tools
}

export type Aggregate = {
  window: Window
  since: number
  until: number
  sessions: number
  workflows: number
  total: Bucket
  byModel: [string, Bucket][]
  byWorkflow: [string, Bucket & { runs: number }][]
  byTicket: [string, Bucket][]
  byObjective: [string, Bucket][]
  byDay: [string, Bucket][]
  topAgents: HistoryAgent[]
}

export function aggregate(sessions: HistorySession[], window: Window, now: number): Aggregate {
  const since = windowStart(window, now)
  const agents = sessions.flatMap(s => s.agents).filter(a => a.endedAt >= since)
  const runs = sessions.flatMap(s => s.runs).filter(r => r.key !== 'solo' && r.startedAt >= since)
  const total = bucket()
  const byModel = new Map<string, Bucket>()
  const byWorkflow = new Map<string, Bucket & { runs: number }>()
  const byTicket = new Map<string, Bucket>()
  const byObjective = new Map<string, Bucket>()
  const byDay = new Map<string, Bucket>()
  const into = <T extends Bucket>(map: Map<string, T>, key: string, make: () => T, a: HistoryAgent) => {
    const b = map.get(key) ?? make()
    add(b, a)
    map.set(key, b)
  }
  for (const a of agents) {
    add(total, a)
    into(byModel, shortModel(a.model), bucket, a)
    if (a.runKey !== 'solo') into(byWorkflow, a.runName, () => ({ ...bucket(), runs: 0 }), a)
    for (const t of a.tickets ?? []) into(byTicket, t, bucket, a)
    for (const o of a.objectives ?? []) into(byObjective, o, bucket, a)
    into(byDay, new Date(a.endedAt).toISOString().slice(0, 10), bucket, a)
  }
  for (const r of runs) {
    const b = byWorkflow.get(r.name) ?? { ...bucket(), runs: 0 }
    b.runs++
    byWorkflow.set(r.name, b)
  }
  const byUsd = (x: [string, Bucket], y: [string, Bucket]) => y[1].usd - x[1].usd || y[1].tokens - x[1].tokens

  return {
    window,
    since,
    until: now,
    sessions: sessions.filter(s => s.agents.some(a => a.endedAt >= since)).length,
    workflows: runs.length,
    total,
    byModel: [...byModel.entries()].sort(byUsd),
    byWorkflow: [...byWorkflow.entries()].sort(byUsd),
    byTicket: [...byTicket.entries()].sort(byUsd),
    byObjective: [...byObjective.entries()].sort(byUsd),
    byDay: [...byDay.entries()].sort((x, y) => x[0].localeCompare(y[0])),
    topAgents: [...agents].sort((x, y) => (y.usd ?? 0) - (x.usd ?? 0)).slice(0, 5),
  }
}

export function shortModel(model: string): string {
  const m = (model ?? '').toLowerCase()
  for (const name of ['haiku', 'sonnet', 'opus', 'fable']) if (m.includes(name)) return name

  return model || '?'
}

function fmtTok(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`

  return `${(n / 1_000_000).toFixed(2)}M`
}

function fmtUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`

  return `$${n.toFixed(2)}`
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`

  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const REPORT = {
  en: {
    title: 'Workflow Visualizer — productivity report',
    window: { today: 'today', '7d': 'last 7 days', '30d': 'last 30 days', all: 'all time' },
    summary: 'Summary',
    sessions: 'sessions',
    workflows: 'workflow runs',
    agents: 'agents',
    success: 'success rate',
    tokens: 'tokens',
    cost: 'estimated cost',
    unpriced: 'unpriced agents',
    avgDur: 'avg agent duration',
    tools: 'tool calls',
    byModel: 'By model',
    byWorkflow: 'By workflow',
    byTicket: 'By ticket',
    byDay: 'By day',
    top: 'Most expensive agents',
    cols: { name: 'name', model: 'model', runs: 'runs', agents: 'agents', ok: 'ok', fail: 'fail', tokens: 'tokens', usd: 'est. USD', avg: 'avg time' },
    none: 'nothing recorded in this window',
    note: 'Costs are estimates at list price per model (cache write at the 1h TTL). Tickets are detected from agent descriptions and prompts.',
    saved: (p: string) => `Saved to ${p}`,
    sprint: 'Sprint objectives',
    sprintLine: (name: string, project: string) => `Open sprint **${name}** (${project})`,
    sprintNone: (project: string) => `No open sprint found for ${project}`,
    sprintTotals: (d: number, n: number, pd: number, p: number) => `issues done: **${d}/${n}** · points done: **${pd}/${p}**`,
    sprintCols: ['key', 'summary', 'status', 'pts', 'agents', 'est. USD'],
    sprintCost: 'agent cost on sprint issues',
    ticketCols: ['summary', 'status'],
    objectives: 'Repo objectives',
    objectivesNone: 'no ADR, spec, OpenSpec, GSD or local ticket artifacts found in the repo',
    objectivesCols: ['objective', 'kind', 'status', 'agents', 'tokens', 'est. USD'],
    artifacts: 'Artifacts in the repo',
    artifactsCols: ['kind', 'total', 'open', 'active', 'done', 'dropped'],
    branch: 'branch',
  },
  es: {
    title: 'Workflow Visualizer — reporte de productividad',
    window: { today: 'hoy', '7d': 'últimos 7 días', '30d': 'últimos 30 días', all: 'todo' },
    summary: 'Resumen',
    sessions: 'sesiones',
    workflows: 'runs de workflow',
    agents: 'agentes',
    success: 'tasa de éxito',
    tokens: 'tokens',
    cost: 'costo estimado',
    unpriced: 'agentes sin precio',
    avgDur: 'duración media por agente',
    tools: 'llamadas a tools',
    byModel: 'Por modelo',
    byWorkflow: 'Por workflow',
    byTicket: 'Por ticket',
    byDay: 'Por día',
    top: 'Agentes más caros',
    cols: { name: 'nombre', model: 'modelo', runs: 'runs', agents: 'agentes', ok: 'ok', fail: 'fail', tokens: 'tokens', usd: 'USD est.', avg: 'tiempo medio' },
    none: 'nada registrado en esta ventana',
    note: 'Los costos son estimados a precio de lista por modelo (cache write con TTL 1h). Los tickets se detectan en descripciones y prompts de los agentes.',
    saved: (p: string) => `Guardado en ${p}`,
    sprint: 'Objetivos del sprint',
    sprintLine: (name: string, project: string) => `Sprint abierto **${name}** (${project})`,
    sprintNone: (project: string) => `No hay sprint abierto para ${project}`,
    sprintTotals: (d: number, n: number, pd: number, p: number) => `issues cerrados: **${d}/${n}** · puntos cerrados: **${pd}/${p}**`,
    sprintCols: ['clave', 'resumen', 'estado', 'pts', 'agentes', 'USD est.'],
    sprintCost: 'costo de agentes en issues del sprint',
    ticketCols: ['resumen', 'estado'],
    objectives: 'Objetivos del repo',
    objectivesNone: 'no hay ADR, specs, OpenSpec, GSD ni tickets locales en el repo',
    objectivesCols: ['objetivo', 'tipo', 'estado', 'agentes', 'tokens', 'USD est.'],
    artifacts: 'Artefactos en el repo',
    artifactsCols: ['tipo', 'total', 'abiertos', 'activos', 'cerrados', 'descartados'],
    branch: 'branch',
  },
} as const

/** One markdown table cell: control characters dropped, pipes escaped, line breaks collapsed. */
export function cell(text: string): string {
  return sanitize(String(text)).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim()
}

export function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(cell).join(' | ')} |`

  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n')
}

function bucketRow(name: string, b: Bucket, extra: string[] = []): string[] {
  return [
    name,
    ...extra,
    String(b.agents),
    String(b.done),
    String(b.failed),
    fmtTok(b.tokens),
    fmtUsd(b.usd) + (b.unpriced ? ` (+${b.unpriced}?)` : ''),
    b.agents ? fmtDur(b.durationMs / b.agents) : '-',
  ]
}

export type TicketInfo = { summary: string; status: string }

export function renderReport(
  agg: Aggregate,
  language: Language,
  extras: { tickets?: Record<string, TicketInfo>; sprint?: JiraSprint | null; sprintProject?: string; sprintError?: string; catalog?: ObjectiveCatalog | null } = {},
): string {
  const r = REPORT[language]
  const c = r.cols
  const t = agg.total
  const head = (extra: string[] = []) => [c.name, ...extra, c.agents, c.ok, c.fail, c.tokens, c.usd, c.avg]
  const out: string[] = []
  out.push(`# ${r.title}`, '', `_${r.window[agg.window]} · ${new Date(agg.until).toISOString().slice(0, 16).replace('T', ' ')}_`, '')
  if (t.agents === 0) {
    out.push(`_${r.none}_`, '')
    pushObjectives(out, agg, r, extras.catalog ?? null)
    pushSprint(out, agg, r, extras)

    return out.join('\n')
  }
  out.push(`## ${r.summary}`, '')
  out.push(`- ${r.sessions}: **${agg.sessions}** · ${r.workflows}: **${agg.workflows}** · ${r.agents}: **${t.agents}**`)
  out.push(`- ${r.success}: **${Math.round((t.done / t.agents) * 100)}%** (${t.done} ok / ${t.failed} fail)`)
  out.push(`- ${r.tokens}: **${fmtTok(t.tokens)}** · ${r.cost}: **≈${fmtUsd(t.usd)}**${t.unpriced ? ` · ${r.unpriced}: ${t.unpriced}` : ''}`)
  out.push(`- ${r.avgDur}: **${fmtDur(t.durationMs / t.agents)}** · ${r.tools}: **${t.tools}**`, '')
  out.push(`## ${r.byModel}`, '', table(head(), agg.byModel.map(([k, b]) => bucketRow(k, b))), '')
  if (agg.byWorkflow.length) {
    out.push(`## ${r.byWorkflow}`, '', table(head([c.runs]), agg.byWorkflow.map(([k, b]) => bucketRow(k, b, [String(b.runs)]))), '')
  }
  if (agg.byTicket.length) {
    const info = extras.tickets ?? {}
    const hasInfo = agg.byTicket.some(([k]) => info[k])
    const rows = agg.byTicket.map(([k, b]) => {
      const row = bucketRow(k, b)
      if (hasInfo) row.splice(1, 0, info[k]?.summary ?? '', info[k]?.status ?? '')

      return row
    })
    const header = head()
    if (hasInfo) header.splice(1, 0, ...r.ticketCols)
    out.push(`## ${r.byTicket}`, '', table(header, rows), '')
  }
  if (agg.byDay.length > 1) {
    out.push(`## ${r.byDay}`, '', table(head(), agg.byDay.map(([k, b]) => bucketRow(k, b))), '')
  }
  pushObjectives(out, agg, r, extras.catalog ?? null)
  pushSprint(out, agg, r, extras)
  out.push(
    `## ${r.top}`,
    '',
    table(
      [c.name, c.model, c.tokens, c.usd, c.avg],
      agg.topAgents.map(a => [
        `${a.description}${a.runKey !== 'solo' ? ` (${a.runName})` : ''}`,
        shortModel(a.model),
        fmtTok(a.input + a.output + a.cacheRead + a.cacheWrite),
        a.usd === null || a.usd === undefined ? '$?' : fmtUsd(a.usd),
        fmtDur(a.endedAt - a.startedAt),
      ]),
    ),
    '',
    `_${r.note}_`,
  )

  return out.join('\n')
}


type ReportStrings = (typeof REPORT)[Language]

function pushSprint(out: string[], agg: Aggregate, r: ReportStrings, extras: { sprint?: JiraSprint | null; sprintProject?: string; sprintError?: string }): void {
  if (extras.sprintProject) {
    out.push(`## ${r.sprint}`, '')
    const sp = extras.sprint
    if (!sp || sp.issues.length === 0) {
      out.push(`_${extras.sprintError ?? r.sprintNone(extras.sprintProject)}_`, '')
    } else {
      const tot = sprintTotals(sp)
      const cost = new Map(agg.byTicket)
      let spent = 0
      out.push(r.sprintLine(sp.name ?? '?', sp.project), '', `- ${r.sprintTotals(tot.done, tot.issues, tot.pointsDone, tot.points)}`)
      const rows = sp.issues.map(i => {
        const b = cost.get(i.key)
        if (b) spent += b.usd

        return [i.key, i.summary.length > 60 ? `${i.summary.slice(0, 59)}…` : i.summary, i.status, i.points === null ? '-' : String(i.points), b ? String(b.agents) : '-', b ? fmtUsd(b.usd) : '-']
      })
      out.push(`- ${r.sprintCost}: **≈${fmtUsd(spent)}**`, '', table([...r.sprintCols], rows), '')
    }
  }
}

function pushObjectives(out: string[], agg: Aggregate, r: ReportStrings, catalog: ObjectiveCatalog | null): void {
  if (!catalog) return
  out.push(`## ${r.objectives}`, '')
  if (catalog.items.length === 0) {
    out.push(`_${r.objectivesNone}_`, '')

    return
  }
  if (catalog.branch) out.push(`_${r.branch}: \`${sanitize(catalog.branch).replace(/`/g, '')}\`_`, '')
  const byId = new Map(catalog.items.map(o => [o.id, o]))
  const cost = new Map(agg.byObjective)
  const touched = catalog.items.filter(o => cost.has(o.id))
  if (touched.length > 0) {
    out.push(
      table(
        [...r.objectivesCols],
        touched
          .sort((x, y) => (cost.get(y.id)?.usd ?? 0) - (cost.get(x.id)?.usd ?? 0))
          .map(o => {
            const b = cost.get(o.id)

            return [`${o.id} ${o.title.length > 50 ? `${o.title.slice(0, 49)}…` : o.title}`, o.kind, o.status, b ? String(b.agents) : '-', b ? fmtTok(b.tokens) : '-', b ? fmtUsd(b.usd) : '-']
          }),
      ),
      '',
    )
  }
  for (const id of cost.keys()) if (!byId.has(id)) out.push(`- ${id}: ${fmtUsd(cost.get(id)?.usd ?? 0)} (artifact no longer in the repo)`)
  const sum = summarize(catalog)
  out.push(`### ${r.artifacts}`, '', table([...r.artifactsCols], Object.entries(sum).map(([k, b]) => [k, String(b.total), String(b.open), String(b.active), String(b.done), String(b.dropped)])), '')
}

export function savedLine(language: Language, path: string): string {
  return REPORT[language].saved(path)
}
