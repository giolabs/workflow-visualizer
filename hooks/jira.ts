import type { McpToolResult } from 'claude-code'

/** What the plugin keeps about one Jira issue, enough for the rack and the report. */
export type JiraIssue = {
  key: string
  summary: string
  status: string
  /** `new` | `indeterminate` | `done`, Jira's status category key. */
  category: 'new' | 'indeterminate' | 'done' | 'unknown'
  type: string
  assignee: string | null
  points: number | null
  sprint: string | null
  sprintState: string | null
  url: string | null
  fetchedAt: number
}

export type JiraSprint = {
  project: string
  name: string | null
  state: string | null
  goal: string | null
  issues: JiraIssue[]
  fetchedAt: number
}

export type JiraConfig = {
  server: string
  project: string
  pointsField: string
}

export const ISSUE_TTL_MS = 10 * 60 * 1000
export const SPRINT_TTL_MS = 5 * 60 * 1000
const CLOUD_KEY = 'jira:cloudId'
export const issueKey = (key: string): string => `jira:issue:${key}`
export const sprintKey = (project: string): string => `jira:sprint:${project}`

type McpDollar = {
  mcp: { call: (server: string, tool: string, args?: Record<string, unknown>) => Promise<McpToolResult> }
  store: { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<void> }
}

/** Tool names the Atlassian MCP has shipped under; the first that answers wins and is remembered. */
const TOOLS = {
  resources: ['getAccessibleAtlassianResources', 'atlassianUserInfo'],
  issue: ['getJiraIssue'],
  search: ['searchJiraIssuesUsingJql', 'searchJiraIssues'],
} as const

type ToolRole = keyof typeof TOOLS

const resolved = new Map<ToolRole, string>()

export class JiraUnavailable extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JiraUnavailable'
  }
}

/** The JSON an MCP result carries: `structuredContent` when given, else the first text block parsed. */
function payload(result: McpToolResult): unknown {
  if (result.structuredContent !== undefined) return result.structuredContent
  const text = result.content.find((b): b is { type: 'text'; text: string } => b.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
  if (!text) return undefined
  try {
    return JSON.parse(text.text)
  } catch {
    return text.text
  }
}

async function callRole($: McpDollar, cfg: JiraConfig, role: ToolRole, args: Record<string, unknown>): Promise<unknown> {
  const known = resolved.get(role)
  const candidates = known ? [known, ...TOOLS[role].filter(t => t !== known)] : [...TOOLS[role]]
  let lastError = ''
  for (const tool of candidates) {
    try {
      const result = await $.mcp.call(cfg.server, tool, args)
      if (result.isError) {
        lastError = String(payload(result) ?? 'tool error')
        // An unknown-tool error means try the next name; any other error is the answer.
        if (/unknown tool|not found|no such tool/i.test(lastError)) continue
        throw new JiraUnavailable(`${tool}: ${lastError.slice(0, 200)}`)
      }
      resolved.set(role, tool)

      return payload(result)
    } catch (err) {
      if (err instanceof JiraUnavailable) throw err
      lastError = err instanceof Error ? err.message : String(err)
      if (!/unknown tool|not found|no such tool|not connected|not available|authenticate/i.test(lastError)) {
        throw new JiraUnavailable(`${tool}: ${lastError.slice(0, 200)}`)
      }
    }
  }
  throw new JiraUnavailable(lastError || `no ${role} tool on ${cfg.server}`)
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export async function cloudId($: McpDollar, cfg: JiraConfig): Promise<{ id: string; url: string | null }> {
  const cached = obj(await $.store.get(CLOUD_KEY))
  if (cached && typeof cached.id === 'string') return { id: cached.id, url: str(cached.url) }
  const data = await callRole($, cfg, 'resources', {})
  const list = Array.isArray(data) ? data : Array.isArray(obj(data)?.resources) ? (obj(data)?.resources as unknown[]) : []
  const first = obj(list[0])
  const id = str(first?.id)
  if (!id) throw new JiraUnavailable('no accessible Atlassian site for this account')
  const site = { id, url: str(first?.url) }
  await $.store.set(CLOUD_KEY, site)

  return site
}

/** Shapes one issue from Jira's REST JSON (what the MCP tools return). */
export function toIssue(raw: unknown, pointsField: string, siteUrl: string | null, now: number): JiraIssue | null {
  const issue = obj(raw)
  const key = str(issue?.key)
  if (!issue || !key) return null
  const fields = obj(issue.fields) ?? {}
  const status = obj(fields.status)
  const categoryKey = str(obj(status?.statusCategory)?.key)
  const sprintRaw = fields.sprint ?? (Array.isArray(fields.customfield_10020) ? fields.customfield_10020[fields.customfield_10020.length - 1] : undefined)
  const sprint = obj(sprintRaw)

  return {
    key,
    summary: str(fields.summary) ?? '',
    status: str(status?.name) ?? 'unknown',
    category: categoryKey === 'new' || categoryKey === 'indeterminate' || categoryKey === 'done' ? categoryKey : 'unknown',
    type: str(obj(fields.issuetype)?.name) ?? '',
    assignee: str(obj(fields.assignee)?.displayName),
    points: num(fields[pointsField]) ?? num(fields.story_points) ?? null,
    sprint: str(sprint?.name),
    sprintState: str(sprint?.state),
    url: siteUrl ? `${siteUrl}/browse/${key}` : null,
    fetchedAt: now,
  }
}

const FIELDS = (pointsField: string) => ['summary', 'status', 'issuetype', 'assignee', 'sprint', 'customfield_10020', pointsField]

export async function fetchIssue($: McpDollar, cfg: JiraConfig, key: string, now: number): Promise<JiraIssue | null> {
  const cached = obj(await $.store.get(issueKey(key)))
  if (cached && typeof cached.fetchedAt === 'number' && now - cached.fetchedAt < ISSUE_TTL_MS) return cached as unknown as JiraIssue
  const site = await cloudId($, cfg)
  const data = await callRole($, cfg, 'issue', { cloudId: site.id, issueIdOrKey: key, fields: FIELDS(cfg.pointsField) })
  const issue = toIssue(data, cfg.pointsField, site.url, now)
  if (issue) await $.store.set(issueKey(key), issue)

  return issue
}

export async function fetchSprint($: McpDollar, cfg: JiraConfig, now: number): Promise<JiraSprint> {
  if (!cfg.project) throw new JiraUnavailable('no jiraProject configured')
  const cached = obj(await $.store.get(sprintKey(cfg.project)))
  if (cached && typeof cached.fetchedAt === 'number' && now - cached.fetchedAt < SPRINT_TTL_MS) return cached as unknown as JiraSprint
  const site = await cloudId($, cfg)
  const data = await callRole($, cfg, 'search', {
    cloudId: site.id,
    jql: `project = ${cfg.project} AND sprint in openSprints() ORDER BY status ASC, created ASC`,
    fields: FIELDS(cfg.pointsField),
    maxResults: 100,
  })
  const list = Array.isArray(obj(data)?.issues) ? (obj(data)?.issues as unknown[]) : Array.isArray(data) ? data : []
  const issues = list.map(i => toIssue(i, cfg.pointsField, site.url, now)).filter((i): i is JiraIssue => i !== null)
  const withSprint = issues.find(i => i.sprint)
  const sprint: JiraSprint = {
    project: cfg.project,
    name: withSprint?.sprint ?? null,
    state: withSprint?.sprintState ?? null,
    goal: null,
    issues,
    fetchedAt: now,
  }
  await $.store.set(sprintKey(cfg.project), sprint)
  for (const i of issues) await $.store.set(issueKey(i.key), i)

  return sprint
}

export function sprintTotals(s: JiraSprint): { issues: number; done: number; points: number; pointsDone: number } {
  let points = 0
  let pointsDone = 0
  let done = 0
  for (const i of s.issues) {
    points += i.points ?? 0
    if (i.category === 'done') {
      done++
      pointsDone += i.points ?? 0
    }
  }

  return { issues: s.issues.length, done, points, pointsDone }
}
