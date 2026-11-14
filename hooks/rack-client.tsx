import type { ClientModule, Color, RenderElement } from 'claude-code'

import { strings } from './i18n'
import type { Language, Strings } from './i18n'

export type ClientAgent = {
  id: string
  runKey: string
  runName: string
  index: number
  parentId: string | null
  description: string
  task: string
  type: string
  model: string
  status: 'spawning' | 'running' | 'idle' | 'done' | 'failed'
  phase: 'boot' | 'thinking' | 'writing' | 'tool' | 'off'
  startedAt: number
  endedAt: number | null
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  steps: number
  tools: number
  turns: number
  doing: string
  log: { at: number; text: string }[]
  history: number[]
  answer: string | null
  usd: number | null
  chosen: { tier: string; reason: string } | null
  objectives: { id: string; via: 'text' | 'file' | 'branch' }[]
}

export type SessionInfo = {
  /** Finished agents that powered off the rack (still in the report). */
  off: number
  contextPct: number | null
  costUsd: number | null
  workflows: number
  agents: number
  live: number
  agentsTokens: number
  agentsUsd: number
  unpriced: number
}

export type ClientTicket = {
  key: string
  summary: string
  status: string
  category: 'new' | 'indeterminate' | 'done' | 'unknown'
  points: number | null
  sprint: string | null
  assignee: string | null
}

export type ClientObjective = { id: string; kind: string; title: string; status: string; phase: 'open' | 'active' | 'done' | 'dropped' | 'unknown' }

export type RackProps = {
  now: number
  language: Language
  main: ClientAgent
  agents: ClientAgent[]
  session: SessionInfo
  tickets: Record<string, ClientTicket>
  objectives: Record<string, ClientObjective>
  branch: string | null
}

const TICKET = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g

function ticketKeys(a: ClientAgent): string[] {
  const out: string[] = []
  for (const text of [a.description, a.task]) for (const hit of text.matchAll(TICKET)) if (!out.includes(hit[0])) out.push(hit[0])

  return out
}

type Local = {
  frame: number
  selected: number
  detail: boolean
  help: boolean
}

const INITIAL: Local = { frame: 0, selected: 0, detail: false, help: false }

// What the handlers read: the last render's sorted agents and size. Handlers are
// registered once, so they must not close over a render's `props`.
const view = { agents: [] as ClientAgent[], columns: 30, rows: 8 }

const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
const TILE_H = 7
const ORCH_H = 6
const MIN_TILE_W = 30
const HEADER_H = 1

function mascot(model: string): string {
  const m = (model ?? '').toLowerCase()
  if (m.includes('haiku')) return '🐇'
  if (m.includes('sonnet')) return '🦊'
  if (m.includes('opus')) return '🦉'
  if (m.includes('fable')) return '🐉'
  return '🤖'
}

function shortModel(model: string): string {
  const m = (model ?? '').toLowerCase()
  for (const name of ['haiku', 'sonnet', 'opus', 'fable']) if (m.includes(name)) return name
  return model.length > 10 ? model.slice(0, 10) : model
}

function rank(total: number, t: Strings): string {
  if (total < 5_000) return t.ranks[0]
  if (total < 25_000) return t.ranks[1]
  if (total < 100_000) return t.ranks[2]
  if (total < 400_000) return t.ranks[3]
  return t.ranks[4]
}

function fmtTok(n: number): string {
  if (n < 1_000) return String(n)
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`
  return `${(n / 1_000_000).toFixed(2)}M`
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function fmtUsd(n: number | null): string {
  if (n === null) return '$?'
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function total(a: ClientAgent): number {
  return a.input + a.output + a.cacheRead + a.cacheWrite
}

function isLive(a: ClientAgent): boolean {
  return a.status === 'running' || a.status === 'spawning'
}

export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text.padEnd(width)
  if (width <= 1) return text.slice(0, width)
  return `${text.slice(0, width - 1)}…`
}

export function wrap(text: string, width: number, lines: number): string[] {
  if (lines <= 0 || width <= 0) return []
  const words = text.split(/\s+/).filter(w => w.length > 0)
  const out: string[] = []
  let cur = ''
  let overflow = false
  for (const w of words) {
    const chunks: string[] = []
    for (let i = 0; i < w.length; i += width) chunks.push(w.slice(i, i + width))
    for (const part of chunks) {
      if (cur.length === 0) cur = part
      else if (cur.length + 1 + part.length <= width) cur += ` ${part}`
      else {
        out.push(cur)
        cur = part
      }
      if (out.length === lines) {
        overflow = true
        break
      }
    }
    if (overflow) break
  }
  if (!overflow && cur) out.push(cur)
  if (overflow) {
    const last = out[lines - 1] ?? ''
    out[lines - 1] = last.length < width ? `${last}…` : `${last.slice(0, width - 1)}…`
  }
  while (out.length < lines) out.push('')

  return out.map(l => fit(l, width))
}

export function spark(history: number[], width: number, frame: number, live: boolean): string {
  if (history.length === 0) {
    if (!live) return '▁'.repeat(width)

    return Array.from({ length: width }, (_, i) => BARS[(i + frame) % 4] ?? '▁').join('')
  }
  const slice = history.slice(-width)
  const max = Math.max(1, ...slice)
  const bars = slice.map(v => BARS[Math.min(7, Math.floor((v / max) * 7))] ?? '▁').join('')

  return bars.padStart(width, '▁')
}

function statusOf(a: ClientAgent, frame: number, t: Strings): { led: string; label: string; color: Color } {
  if (a.status === 'done') return { led: '●', label: t.leds.done, color: 'success' }
  if (a.status === 'failed') return { led: '●', label: t.leds.fail, color: 'error' }
  if (a.status === 'idle') return { led: '◐', label: t.leds.idle, color: 'subtle' }
  if (a.status === 'spawning') return { led: '◌', label: t.leds.boot, color: 'inactive' }
  const blink = frame % 6 < 3
  const label = a.phase === 'thinking' ? t.leds.think : a.phase === 'writing' ? t.leds.write : t.leds.work

  return { led: blink ? '●' : '○', label, color: a.phase === 'thinking' ? 'suggestion' : 'warning' }
}

function rowsForGrid(s: Local, rows: number): number {
  const detailH = s.detail ? Math.min(13, Math.max(8, Math.floor(rows / 2))) : 0
  const helpH = s.help ? 3 : 0

  return Math.max(1, Math.floor((rows - HEADER_H - ORCH_H - detailH - helpH) / TILE_H))
}

function firstRowOf(selectedAgent: number, gridCols: number, gridRowsVisible: number, totalRows: number): number {
  const selRow = Math.floor(Math.max(0, selectedAgent) / gridCols)

  return Math.max(0, Math.min(selRow - gridRowsVisible + 1, totalRows - gridRowsVisible))
}

const Rack: ClientModule<RackProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const t = strings(props.language)
  const cols = Math.max(30, surface.columns)
  const rows = Math.max(8, surface.rows)
  const agents = [...props.agents].sort(
    (a, b) => a.runKey.localeCompare(b.runKey) || a.index - b.index || a.startedAt - b.startedAt,
  )
  view.agents = agents
  view.columns = cols
  view.rows = rows
  const gridCols = Math.max(1, Math.floor(cols / MIN_TILE_W))
  const tileW = Math.floor(cols / gridCols)

  // Selection index 0 is the orchestrator; agents follow at 1..n.
  if (surface.state === undefined) {
    surface.setState(INITIAL)
    surface.every(160, () => {
      const s = surface.state ?? INITIAL
      surface.setState({ ...s, frame: s.frame + 1 })
    })
    surface.onKey(e => {
      const s = surface.state ?? INITIAL
      const count = view.agents.length + 1
      const gc = Math.max(1, Math.floor(view.columns / MIN_TILE_W))
      const cur = Math.min(s.selected, count - 1)
      const go = (idx: number) => surface.setState({ ...s, selected: Math.max(0, Math.min(count - 1, idx)) })
      if (e.key === 'left' || e.key === 'h') go(cur - 1)
      else if (e.key === 'right' || e.key === 'l') go(cur + 1)
      else if (e.key === 'up' || e.key === 'k') go(cur - gc < 1 ? 0 : cur - gc)
      else if (e.key === 'down' || e.key === 'j') go(cur === 0 ? 1 : cur + gc)
      else if (e.key === 'return' || e.key === ' ') surface.setState({ ...s, detail: !s.detail })
      else if (e.key === '?') surface.setState({ ...s, help: !s.help })
    })
    surface.onPointer(e => {
      if (e.type !== 'down' || e.y < HEADER_H) return
      const s = surface.state ?? INITIAL
      const count = view.agents.length + 1
      const cur = Math.min(s.selected, count - 1)
      const pick = (idx: number) => surface.setState({ ...s, selected: idx, detail: idx === cur ? !s.detail : true })
      if (e.y < HEADER_H + ORCH_H) {
        pick(0)

        return
      }
      if (view.agents.length === 0) return
      const gc = Math.max(1, Math.floor(view.columns / MIN_TILE_W))
      const tw = Math.floor(view.columns / gc)
      const visibleRows = rowsForGrid(s, view.rows)
      const row = Math.floor((e.y - HEADER_H - ORCH_H) / TILE_H)
      const col = Math.min(gc - 1, Math.floor(e.x / tw))
      if (row >= visibleRows) return
      const totalRows = Math.ceil(view.agents.length / gc)
      const first = firstRowOf(cur - 1, gc, visibleRows, totalRows)
      const idx = (row + first) * gc + col
      if (idx < view.agents.length) pick(idx + 1)
    })
  }
  const local = surface.state ?? INITIAL
  const selIdx = Math.min(local.selected, agents.length)
  const selected: ClientAgent | undefined = selIdx === 0 ? props.main : agents[selIdx - 1]
  const spin = SPIN[local.frame % SPIN.length] ?? '⠋'

  const detailH = local.detail && selected ? Math.min(13, Math.max(8, Math.floor(rows / 2))) : 0
  const helpH = local.help ? 3 : 0
  const gridRowsVisible = Math.max(1, Math.floor((rows - HEADER_H - ORCH_H - detailH - helpH) / TILE_H))
  const totalGridRows = Math.max(1, Math.ceil(agents.length / gridCols))
  const firstRow = firstRowOf(selIdx - 1, gridCols, gridRowsVisible, totalGridRows)
  const visible = agents.slice(firstRow * gridCols, (firstRow + gridRowsVisible) * gridCols)

  const header = (
    <Box justifyContent="space-between">
      <Text bold color="claude">
        {' '}🏟 {t.paneTitle.toUpperCase()} <Text dimColor>{t.rack} · {agents.length} {t.servers}{props.session.off > 0 ? ` · ${props.session.off} ${t.poweredOff}` : ''}</Text>
      </Text>
      <Text>
        <Text dimColor>{props.session.live > 0 ? `${spin} ${props.session.live} ${t.online} · ` : ''}{t.sumAgents} </Text>
        <Text bold>{fmtTok(props.session.agentsTokens)}</Text>
        <Text dimColor> tok ≈ </Text>
        <Text bold color="success">{fmtUsd(props.session.agentsUsd)}</Text>
        <Text dimColor>{props.session.unpriced > 0 ? t.unpriced(props.session.unpriced) : ''} · {t.keysHint} </Text>
      </Text>
    </Box>
  )

  const m = props.main
  const mSt = statusOf(m, local.frame, t)
  const mSel = selIdx === 0
  const mInner = cols - 4
  const mDoing = fit(m.doing, Math.max(10, mInner - 2))
  const ctx = props.session.contextPct === null ? t.contextUnknown : `${t.context} ${Math.round(props.session.contextPct)}%`
  const cost = props.session.costUsd === null ? '' : ` · ${t.sessionReal} ${fmtUsd(props.session.costUsd)}`
  const orchestrator = (
    <Box
      flexDirection="column"
      width={cols}
      height={ORCH_H}
      borderStyle={mSel ? 'double' : 'bold'}
      borderColor={mSel ? 'claude' : m.status === 'running' ? 'warning' : 'subtle'}
      paddingX={1}
    >
      <Box justifyContent="space-between">
        <Text>
          🎛 <Text bold inverse={mSel}>{t.orchestratorName.toUpperCase()}</Text> <Text dimColor>{shortModel(m.model)} · {t.turn} {m.turns}</Text>
        </Text>
        <Text color={mSt.color}>
          {mSt.led} {mSt.label} {fmtDur((m.endedAt ?? props.now) - m.startedAt)}
        </Text>
      </Box>
      <Text>
        <Text dimColor>{t.roleLabel}</Text>
        {fit(t.roleText, Math.max(10, mInner - t.roleLabel.length - (props.branch ? props.branch.length + 4 : 0)))}
        {props.branch ? <Text dimColor> ⎇ {props.branch}</Text> : null}
      </Text>
      <Text color={m.status === 'running' ? 'text' : 'inactive'}>▸ {mDoing}</Text>
      <Text dimColor>
        {props.session.workflows} {t.workflows} · {props.session.agents} {t.agents} · {props.session.live} {t.online} · {ctx}
        {cost} · <Text color={mSt.color}>{spark(m.history, 8, local.frame, m.status === 'running')}</Text>{' '}
        {fmtTok(total(m))} tok ≈ {fmtUsd(m.usd)}
      </Text>
    </Box>
  )

  const tiles: RenderElement[] = []
  for (let r = 0; r < gridRowsVisible; r++) {
    const rowAgents = visible.slice(r * gridCols, (r + 1) * gridCols)
    if (rowAgents.length === 0) break
    tiles.push(
      <Box>
        {rowAgents.map(a => {
          const isSel = selected?.id === a.id
          const st = statusOf(a, local.frame, t)
          const inner = tileW - 4
          const title = fit(a.description, Math.max(4, inner - 3 - shortModel(a.model).length - 1))
          const doing = wrap(a.doing, inner - 2, 2)
          const elapsed = fmtDur((a.endedAt ?? props.now) - a.startedAt)
          const sparkW = Math.max(4, Math.min(12, inner - 12))

          return (
            <Box
              flexDirection="column"
              width={tileW}
              height={TILE_H}
              borderStyle={isSel ? 'double' : 'round'}
              borderColor={isSel ? 'claude' : st.color}
              borderDimColor={!isSel && !isLive(a)}
              paddingX={1}
            >
              <Text>
                {mascot(a.model)} <Text bold inverse={isSel}>{title}</Text>{' '}
                <Text dimColor>{shortModel(a.model)}</Text>
              </Text>
              <Text>
                <Text color={st.color}>{st.led} {st.label}</Text> {elapsed}
                <Text dimColor> · {t.step} {a.steps} · {a.tools} {t.tools}</Text>
              </Text>
              <Text color={isLive(a) ? 'text' : 'inactive'}>▸ {doing[0]}</Text>
              <Text dimColor>  {doing[1]}</Text>
              <Text>
                <Text color={st.color}>{spark(a.history, sparkW, local.frame, isLive(a))}</Text>{' '}
                <Text bold>{fmtTok(total(a))}</Text>
                <Text dimColor> tok </Text>
                <Text color="success">{fmtUsd(a.usd)}</Text>
              </Text>
            </Box>
          )
        })}
      </Box>,
    )
  }

  const empty = agents.length === 0 && (
    <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
      <Text dimColor>{t.emptyTitle}</Text>
      <Text dimColor>{t.emptyLine1}</Text>
      <Text dimColor>{t.emptyLine2}</Text>
    </Box>
  )

  const scrollNote = totalGridRows > gridRowsVisible && (
    <Text dimColor>
      {' '}
      {firstRow > 0 ? t.moreAbove(firstRow * gridCols) : ''}
      {(firstRow + gridRowsVisible) * gridCols < agents.length
        ? t.moreBelow(agents.length - (firstRow + gridRowsVisible) * gridCols)
        : ''}
    </Text>
  )

  let detail: RenderElement | false = false
  if (local.detail && selected) {
    const a = selected
    const st = statusOf(a, local.frame, t)
    const w = cols - 4
    const isMain = a.id === props.main.id
    const children = isMain ? agents.filter(x => x.parentId === null) : agents.filter(x => x.parentId === a.id)
    const logRoom = Math.max(2, detailH - 7 - (a.answer ? 2 : 0) - Math.min(2, ticketKeys(a).length) - Math.min(2, a.objectives.length))
    const logs = a.log.slice(-logRoom)
    const taskLines = wrap(a.task, w - 7, 2)
    const answerLines = a.answer ? wrap(a.answer, w - 9, 2) : []

    detail = (
      <Box flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1} height={detailH}>
        <Box justifyContent="space-between">
          <Text>
            {isMain ? '🎛' : mascot(a.model)} <Text bold>{a.description}</Text>{' '}
            <Text dimColor>
              {shortModel(a.model)} · {a.type} · {a.runName}
              {children.length > 0 ? t.launchedCount(children.length) : ''}
            </Text>
          </Text>
          <Text color={st.color}>
            {st.led} {st.label} {fmtDur((a.endedAt ?? props.now) - a.startedAt)}
          </Text>
        </Box>
        <Text>
          <Text color="suggestion">█</Text> {t.cache} {fmtTok(a.cacheRead)} <Text color="warning">█</Text> {t.input}{' '}
          {fmtTok(a.input)} <Text color="success">█</Text> {t.output} {fmtTok(a.output)}
          <Text dimColor>
            {' '}
            = {fmtTok(total(a))} tok ≈ {fmtUsd(a.usd)} · {rank(total(a), t)} · {a.steps} {t.steps} · {a.tools} {t.tools}
            {isMain ? ` · ${a.turns} ${t.turns}` : ''}
          </Text>
        </Text>
        <Text>
          <Text dimColor>{isMain ? t.roleLabel.padEnd(7) : t.taskLabel}</Text>
          {taskLines[0]}
        </Text>
        <Text>       {taskLines[1]}</Text>
        <Text>
          <Text dimColor>{t.nowLabel}</Text>
          <Text color={a.status === 'running' ? 'text' : 'inactive'}>{fit(a.doing, w - 7)}</Text>
        </Text>
        {a.chosen ? (
          <Text>
            <Text dimColor>{t.chosenLabel}</Text>
            {fit(`${a.model} · ${t.modelReason[a.chosen.reason] ?? a.chosen.reason}`, w - 8)}
          </Text>
        ) : null}
        {a.objectives.slice(0, 2).map(m => {
          const o = props.objectives[m.id]
          const color: Color = o?.phase === 'done' ? 'success' : o?.phase === 'active' ? 'warning' : o?.phase === 'dropped' ? 'inactive' : 'text'

          return (
            <Text>
              <Text dimColor>{t.objectiveLabel}</Text>
              <Text bold>{m.id}</Text>
              <Text dimColor> {o?.kind ?? ''}</Text>
              {o ? (
                <Text>
                  {' '}
                  <Text color={color}>{o.status}</Text>
                  <Text dimColor> · {fit(o.title, Math.max(10, w - 44))}</Text>
                </Text>
              ) : null}
              <Text dimColor>{m.via === 'text' ? '' : ` (${m.via === 'branch' ? t.branchLabel : 'files'})`}</Text>
            </Text>
          )
        })}
        {ticketKeys(a).slice(0, 2).map(k => {
          const tk = props.tickets[k]
          const color: Color = tk?.category === 'done' ? 'success' : tk?.category === 'indeterminate' ? 'warning' : 'text'

          return (
            <Text>
              <Text dimColor>{t.ticketLabel}</Text>
              <Text bold>{k}</Text>
              {tk ? (
                <Text>
                  {' '}
                  <Text color={color}>{tk.status}</Text>
                  {tk.points !== null ? ` · ${tk.points} pts` : ''}
                  {tk.sprint ? ` · ${tk.sprint}` : ''}
                  <Text dimColor> · {fit(tk.summary, Math.max(10, w - 40))}</Text>
                </Text>
              ) : (
                <Text dimColor> {t.ticketUnknown}</Text>
              )}
            </Text>
          )
        })}
        <Text dimColor>{t.lastActions}</Text>
        {logs.map(l => (
          <Text>
            <Text dimColor>  {fmtDur(l.at - a.startedAt)} </Text>
            {fit(l.text, w - 9)}
          </Text>
        ))}
        {a.answer && (
          <Text>
            <Text dimColor>{isMain ? t.saidLabel : t.reportLabel}</Text>
            {answerLines[0]}
          </Text>
        )}
        {a.answer && <Text>         {answerLines[1]}</Text>}
      </Box>
    )
  }

  const help = local.help && (
    <Box flexDirection="column" paddingLeft={1}>
      <Text dimColor>{t.help1}</Text>
      <Text dimColor>{t.help2}</Text>
      <Text dimColor>{t.help3}</Text>
    </Box>
  )

  return (
    <Box flexDirection="column" width={cols}>
      {header}
      {orchestrator}
      {empty}
      {tiles}
      {scrollNote}
      {detail}
      {help}
    </Box>
  )
}

export default Rack
