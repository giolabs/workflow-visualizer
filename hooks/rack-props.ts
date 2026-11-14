// What the rack Client is handed, kept under the engine's bound on a `Client`'s props (100,000
// characters serialized): every text clipped to what a tile or the detail panel can show, and,
// when a long loop still piles up more than fits, the oldest finished agents left out and counted
// as powered off.
import type { ClientAgent, RackProps } from './rack-client'
import { clip } from './text'

/** Room left under the engine's 100k bound for the serialization itself to vary. */
export const PROPS_BUDGET = 90_000
const TASK_MAX = 300 // two detail lines at any terminal width
const ANSWER_MAX = 300
const DOING_MAX = 160
const LOG_MAX = 8
const LOG_TEXT_MAX = 120

/** The agent with only what the Client draws, each text no longer than its widest line. */
export function slim(a: ClientAgent): ClientAgent {
  return {
    ...a,
    description: clip(a.description, 200),
    task: clip(a.task, TASK_MAX),
    doing: clip(a.doing, DOING_MAX),
    answer: a.answer === null ? null : clip(a.answer, ANSWER_MAX),
    log: a.log.slice(-LOG_MAX).map(l => ({ at: l.at, text: clip(l.text, LOG_TEXT_MAX) })),
  }
}

export const propsSize = (props: RackProps): number => JSON.stringify(props).length

/**
 * The props cut to the budget: finished agents leave first, oldest first, then live ones oldest
 * first (the main agent, the session counts, tickets and objectives stay). Each agent left out is
 * counted in `session.off`, as a powered-off one is.
 */
export function fitProps(props: RackProps, budget = PROPS_BUDGET): RackProps {
  let out = props
  while (propsSize(out) > budget && out.agents.length > 0) {
    const finished = out.agents.filter(a => a.status !== 'running' && a.status !== 'spawning')
    const pool = finished.length > 0 ? finished : out.agents
    const victim = pool.reduce((v, a) => ((a.endedAt ?? a.startedAt) < (v.endedAt ?? v.startedAt) ? a : v))
    out = { ...out, agents: out.agents.filter(a => a.id !== victim.id), session: { ...out.session, off: out.session.off + 1 } }
  }

  return out
}
