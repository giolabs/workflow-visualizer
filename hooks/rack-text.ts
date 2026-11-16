// The rack as text: the same header, orchestrator and tiles the pane draws, in box-drawing
// characters inside one code block. For hosts that attach no drawing surface (a chat client such
// as Orca in chat mode, a -p run), where a pane has nowhere to seat: `/wv rack` prints it and the
// `rack` tool hands it to the model to paste when a workflow ends.
import type { ClientAgent, RackProps } from './rack-client'
import { fit, fmtDur, fmtTok, fmtUsd, isLive, shortModel, spark, statusOf, total } from './rack-client'
import { strings } from './i18n'

const MIN_TILE_W = 42
const TILE_LINES = 4

function box(lines: string[], inner: number, style: 'double' | 'round'): string[] {
  const [tl, tr, bl, br, h, v] = style === 'double' ? ['╔', '╗', '╚', '╝', '═', '║'] : ['╭', '╮', '╰', '╯', '─', '│']
  const bar = h!.repeat(inner + 2)

  return [`${tl}${bar}${tr}`, ...lines.map(l => `${v} ${fit(l, inner)} ${v}`), `${bl}${bar}${br}`]
}

function sides(left: string, right: string, inner: number): string {
  const room = Math.max(0, inner - right.length - 1)

  return `${fit(left, room)} ${right}`
}

function tile(a: ClientAgent, inner: number, now: number, t: ReturnType<typeof strings>): string[] {
  const st = statusOf(a, 0, t)
  const model = shortModel(a.model)
  const sparkW = Math.max(4, Math.min(12, inner - 14))

  return box(
    [
      sides(a.description, model, inner),
      `${st.led} ${st.label} ${fmtDur((a.endedAt ?? now) - a.startedAt)} · ${t.step} ${a.steps} · ${a.tools} ${t.tools}`,
      `▸ ${fit(a.doing, inner - 2).trimEnd()}`,
      `${spark(a.history, sparkW, 0, isLive(a))} ${fmtTok(total(a))} tok ≈ ${fmtUsd(a.usd)}`,
    ],
    inner,
    'round',
  )
}

/** The rack drawn in `width` columns of text, ready for a fenced code block. */
export function renderRackText(props: RackProps, width = 84): string {
  const t = strings(props.language)
  const cols = Math.max(60, width)
  const agents = [...props.agents].sort((a, b) => a.runKey.localeCompare(b.runKey) || a.index - b.index || a.startedAt - b.startedAt)
  const s = props.session
  const out: string[] = []

  out.push(
    fit(
      `${t.paneTitle.toUpperCase()} · ${t.rack} · ${agents.length} ${t.servers}${s.off > 0 ? ` · ${s.off} ${t.poweredOff}` : ''} · ${t.sumAgents} ${fmtTok(s.agentsTokens)} tok ≈ ${fmtUsd(s.agentsUsd)}${s.unpriced > 0 ? t.unpriced(s.unpriced) : ''}`,
      cols,
    ).trimEnd(),
  )

  const m = props.main
  const mSt = statusOf(m, 0, t)
  const inner = cols - 4
  const ctx = s.contextPct === null ? t.contextUnknown : `${t.context} ${Math.round(s.contextPct)}%`
  const cost = s.costUsd === null ? '' : ` · ${t.sessionReal} ${fmtUsd(s.costUsd)}`
  out.push(
    ...box(
      [
        sides(`${t.orchestratorName.toUpperCase()}  ${shortModel(m.model)} · ${t.turn} ${m.turns}`, `${mSt.led} ${mSt.label} ${fmtDur((m.endedAt ?? props.now) - m.startedAt)}`, inner),
        `${t.roleLabel}${t.roleText}${props.branch ? ` ⎇ ${props.branch}` : ''}`,
        `▸ ${m.doing}`,
        `${s.workflows} ${t.workflows} · ${s.agents} ${t.agents} · ${s.live} ${t.online} · ${ctx}${cost}`,
      ],
      inner,
      'double',
    ),
  )

  if (agents.length === 0) {
    out.push(t.emptyTitle)

    return out.join('\n')
  }

  const gridCols = Math.max(1, Math.floor(cols / MIN_TILE_W))
  const tileW = Math.floor((cols - (gridCols - 1)) / gridCols)
  const tileInner = tileW - 4
  for (let i = 0; i < agents.length; i += gridCols) {
    const row = agents.slice(i, i + gridCols).map(a => tile(a, tileInner, props.now, t))
    for (let line = 0; line < TILE_LINES + 2; line++) out.push(row.map(b => b[line] ?? ' '.repeat(tileW)).join(' ').trimEnd())
  }

  return out.join('\n')
}

/** The text inside a fenced block, as a command answer or a tool result shows it. */
export const fenced = (text: string): string => `\`\`\`text\n${text}\n\`\`\``
