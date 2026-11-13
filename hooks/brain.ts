/**
 * The orchestrator's reasoning: the decisions the plugin takes on its own about the agents
 * it watches. Today two of them, each a pure function the hooks call:
 *
 *   - `chooseModel`: which model a subagent should run on, from the task it was handed, when
 *     nobody fixed one (the Workflow script, the Agent call or the agent's own definition).
 *   - `isPoweredOff`: when a finished agent leaves the rack after delivering its report.
 *
 * Further decisions (effort per task, retries, budget caps, parallelism) belong here too.
 */

export type ModelTier = 'haiku' | 'sonnet' | 'opus'

export type ModelReason = 'review' | 'architecture' | 'ui' | 'synthesis' | 'implementation' | 'tests' | 'research' | 'explore-type' | 'plan-type' | 'default'

export type ModelChoice = { tier: ModelTier; reason: ModelReason; matched: string }

export type ModelPolicy = 'auto' | 'off'

export type SpawnFacts = {
  description: string
  prompt: string
  subagentType: string
  model: string | undefined
  fork: boolean
  isTeammate: boolean
  isResume: boolean
}

/** A finished tile stays a minute with its cost, then powers off (the report keeps it). */
export const OFF_AFTER_MS = 60_000

/** How much of the task text the rules read: the head carries the intent. */
const READ_MAX = 4_000

type Rule = { tier: ModelTier; reason: ModelReason; words: readonly string[] }

// The earliest word of the task that matches a rule decides (see chooseModel).
// Word lists are English and Spanish stems, matched on word boundaries, case-insensitive.
const RULES: readonly Rule[] = [
  { tier: 'opus', reason: 'review', words: ['review', 'code review', 'audit', 'auditor', 'security', 'vulnerab', 'regression', 'verify', 'verification', 'verific', 'revis', 'auditor', 'segurid'] },
  { tier: 'opus', reason: 'architecture', words: ['architect', 'adr', 'adrs', 'decide', 'decision', 'trade-off', 'tradeoff', 'design doc', 'spec', 'specs', 'specification', 'arquitect', 'decid', 'especificaci'] },
  { tier: 'opus', reason: 'ui', words: ['ui', 'ux', 'figma', 'screen', 'layout', 'component library', 'design system', 'pantalla', 'dise'] },
  { tier: 'opus', reason: 'synthesis', words: ['synthesi', 'synthesize', 'consolidate', 'final report', 'conclusion', 'judge', 'sintetiz', 'sintesis', 'síntesis', 'consolid', 'conclusi'] },
  { tier: 'sonnet', reason: 'tests', words: ['test', 'tests', 'testing', 'spec file', 'coverage', 'e2e', 'unit test', 'prueba'] },
  { tier: 'sonnet', reason: 'implementation', words: ['implement', 'write code', 'fix', 'fixes', 'refactor', 'migrate', 'migration', 'build', 'add endpoint', 'feature', 'bug', 'bugs', 'patch', 'implementa', 'arregl', 'refactoriz', 'migra', 'construi', 'program'] },
  { tier: 'haiku', reason: 'research', words: ['research', 'read-only', 'read only', 'search', 'find', 'grep', 'list', 'listing', 'inventory', 'summar', 'summarize', 'explore', 'scan', 'lookup', 'look up', 'collect', 'gather', 'investig', 'busc', 'inventari', 'resum', 'explor', 'recolect', 'relev'] },
]

const TYPE_DEFAULTS: Readonly<Record<string, ModelChoice>> = {
  Explore: { tier: 'haiku', reason: 'explore-type', matched: 'Explore' },
  Plan: { tier: 'opus', reason: 'plan-type', matched: 'Plan' },
}

function escapeRe(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const MATCHERS: readonly { rule: Rule; re: RegExp }[] = RULES.map(rule => ({
  rule,
  // A stem matches the word it starts (`revis` → revisar, revisión); a full word stays whole.
  re: new RegExp(`(?:^|[^\\p{L}\\p{N}])(${rule.words.map(w => (w.length < 5 ? `${escapeRe(w)}(?![\\p{L}\\p{N}])` : escapeRe(w))).join('|')})`, 'iu'),
}))

/**
 * Whether the plugin should pick a model for this spawn: only when nobody did (no `model` on the
 * call or script), never for a fork (it inherits), a teammate, a resumed run or a plugin's own
 * agent type (`plugin:agent`, whose definition may name a model the plugin cannot see).
 */
export function shouldChooseModel(policy: ModelPolicy, facts: SpawnFacts): boolean {
  if (policy !== 'auto') return false
  if (facts.model !== undefined || facts.fork || facts.isTeammate || facts.isResume) return false

  return !facts.subagentType.includes(':')
}

/** Rules that win on sight in the description (the intent line): the kind of work, not its verb. */
const ON_SIGHT: readonly ModelReason[] = ['review', 'ui']

/**
 * The model tier a task deserves. The earliest matching word of the task text decides (a verb
 * usually leads: "Search … every spec" is research, "Review …" is review), except that review and
 * UI work named anywhere in the description win outright; with no match, the agent type's default,
 * else sonnet.
 */
export function chooseModel(facts: Pick<SpawnFacts, 'description' | 'prompt' | 'subagentType'>): ModelChoice {
  const description = facts.description.slice(0, READ_MAX)
  for (const { rule, re } of MATCHERS) {
    if (!ON_SIGHT.includes(rule.reason)) continue
    const hit = re.exec(description)
    if (hit?.[1]) return { tier: rule.tier, reason: rule.reason, matched: hit[1].toLowerCase() }
  }
  const text = `${description}\n${facts.prompt}`.slice(0, READ_MAX)
  let best: { at: number; choice: ModelChoice } | undefined
  for (const { rule, re } of MATCHERS) {
    const hit = re.exec(text)
    if (!hit?.[1]) continue
    const at = hit.index + hit[0].length - hit[1].length
    if (!best || at < best.at) best = { at, choice: { tier: rule.tier, reason: rule.reason, matched: hit[1].toLowerCase() } }
  }
  if (best) return best.choice
  const byType = TYPE_DEFAULTS[facts.subagentType]
  if (byType) return byType

  return { tier: 'sonnet', reason: 'default', matched: facts.subagentType || 'agent' }
}

/** A finished agent that delivered its report a while ago: off the rack, kept in the history. */
export function isPoweredOff(a: { status: string; endedAt?: number }, now: number): boolean {
  return (a.status === 'done' || a.status === 'failed') && a.endedAt !== undefined && now - a.endedAt >= OFF_AFTER_MS
}

/** Whether the pane still needs ticks for this agent: live, or finished and not yet powered off. */
export function isCoolingDown(a: { status: string; endedAt?: number }, now: number): boolean {
  return (a.status === 'done' || a.status === 'failed') && a.endedAt !== undefined && now - a.endedAt < OFF_AFTER_MS
}
