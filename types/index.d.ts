export type RackStatus = 'spawning' | 'running' | 'idle' | 'done' | 'failed'

export type RackPhase = 'boot' | 'thinking' | 'writing' | 'tool' | 'off'

export type RackLogEntry = {
  at: number
  text: string
}

/** One model loop in the rack: the orchestrator (id `main`) or an agent. */
export type RackAgent = {
  id: string
  runKey: string
  index: number
  parentId?: string
  description: string
  task: string
  type: string
  model: string
  status: RackStatus
  phase: RackPhase
  startedAt: number
  endedAt?: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  steps: number
  tools: number
  turns: number
  doing: string
  log: RackLogEntry[]
  history: number[]
  answer?: string
  /** Repo-relative or absolute paths the loop read, edited or wrote (last 40). */
  files: string[]
  /** The model the plugin chose for this agent (nobody had fixed one) and the rule that chose it. */
  chosen?: { tier: string; reason: string; matched: string }
}

/** One Workflow run (or the `solo` group of standalone Agent calls). */
export type RackRun = {
  key: string
  runId?: string
  name: string
  startedAt: number
  endedAt?: number
}

/** What the rack keeps about a Jira issue an agent mentioned. */
export type RackTicket = {
  key: string
  summary: string
  status: string
  category: 'new' | 'indeterminate' | 'done' | 'unknown'
  type: string
  assignee: string | null
  points: number | null
  sprint: string | null
  url: string | null
  fetchedAt: number
}

export type RackObjective = {
  id: string
  kind: 'adr' | 'spec' | 'openspec-change' | 'openspec-spec' | 'gsd-phase' | 'story' | 'bug' | 'epic' | 'ticket'
  title: string
  status: string
  phase: 'open' | 'active' | 'done' | 'dropped' | 'unknown'
  path: string
  keys: string[]
}

export type RackCatalog = {
  root: string
  branch: string | null
  scannedAt: number
  items: RackObjective[]
}

export type RackState = {
  runs: RackRun[]
  agents: RackAgent[]
  main?: RackAgent
  tickets: Record<string, RackTicket>
  objectives?: RackCatalog
}

declare module 'claude-code' {
  interface PluginState {
    'workflow-visualizer': { rack: Shaped<RackState>; tick: number }
  }
}
