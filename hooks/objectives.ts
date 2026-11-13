/**
 * Repo objectives: the ADRs, specs, OpenSpec changes, GSD phases and local
 * tickets a repository keeps as markdown. Scanned with `$.fs`, no model, no
 * network, so the plugin measures objectives with no Jira at all.
 */

export type ObjectiveKind = 'adr' | 'spec' | 'openspec-change' | 'openspec-spec' | 'gsd-phase' | 'story' | 'bug' | 'epic' | 'ticket'

export type RepoObjective = {
  /** Stable id: `ADR-006`, `US-023`, `EP-001`, `openspec:add-billing`, `spec:conclave-board`, `phase:03-auth`. */
  id: string
  kind: ObjectiveKind
  title: string
  status: string
  /** `open` | `active` | `done` | `dropped` | `unknown`, normalized from `status`. */
  phase: 'open' | 'active' | 'done' | 'dropped' | 'unknown'
  /** Repo-relative path of the artifact (a file or a directory). */
  path: string
  /** Lower-case words that identify it in prose, branch names and paths: `ADR-006`, `three-wave`, slug parts. */
  keys: string[]
}

export type ObjectiveCatalog = {
  root: string
  branch: string | null
  scannedAt: number
  items: RepoObjective[]
}

type FsDollar = {
  fs: {
    list: (path?: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other'; isLink?: boolean }[]>
    read: (path: string) => Promise<string>
    exists: (path: string) => Promise<boolean>
  }
}

const MAX_FILES = 400
const MAX_READ = 64 * 1024
/** Longest line a title or status is parsed from; longer lines are cut before any regex runs. */
const MAX_LINE = 300
/** Most artifacts one catalog holds; the scan stops listing once reached. */
export const MAX_ITEMS = 500

/** Where each kind lives, as `[dir, fileRule]` with `*` one path segment. */
const SOURCES: { kind: ObjectiveKind; pattern: string }[] = [
  { kind: 'adr', pattern: 'docs/adr/*.md' },
  { kind: 'adr', pattern: 'docs/decisions/*.md' },
  { kind: 'adr', pattern: 'docs/architecture/decisions/*.md' },
  { kind: 'adr', pattern: 'adr/*.md' },
  { kind: 'adr', pattern: 'conclave/product/adr/*.md' },
  { kind: 'spec', pattern: 'docs/specs/*.md' },
  { kind: 'spec', pattern: 'docs/specs/*/spec.md' },
  { kind: 'spec', pattern: 'docs/specs/*/SPEC.md' },
  { kind: 'spec', pattern: 'specs/*.md' },
  { kind: 'spec', pattern: '.planning/specs/*.md' },
  { kind: 'openspec-change', pattern: 'openspec/changes/*/proposal.md' },
  { kind: 'openspec-spec', pattern: 'openspec/specs/*/spec.md' },
  { kind: 'gsd-phase', pattern: '.planning/phases/*' },
  { kind: 'story', pattern: 'conclave/sprints/*/stories/*.md' },
  { kind: 'bug', pattern: 'conclave/sprints/*/bugs/*.md' },
  { kind: 'epic', pattern: 'conclave/product/epics/*.md' },
  { kind: 'ticket', pattern: 'scrum/tickets/*.md' },
]

const DONE = /^(accepted|approved|done|closed|completed|complete|merged|archived|implemented|verified|released|shipped)$/i
const ACTIVE = /^(in[- _]?progress|active|doing|review|in[- _]review|ready|implementing|wip)$/i
const DROPPED = /^(rejected|superseded|deprecated|retired|dropped|cancelled|canceled|abandoned|wontfix)$/i
const OPEN = /^(proposed|draft|open|todo|to[- _]do|backlog|pending|planned|new|idea)$/i

export function normalizeStatus(status: string): RepoObjective['phase'] {
  const s = status.trim()
  if (!s) return 'unknown'
  if (DONE.test(s)) return 'done'
  if (ACTIVE.test(s)) return 'active'
  if (DROPPED.test(s)) return 'dropped'
  if (OPEN.test(s)) return 'open'

  return 'unknown'
}

const ID_IN_NAME = /\b(ADR|SPEC|US|BUG|EP|SPRINT|RFC|TASK|T)-?(\d{1,5})\b/i
const NUMBERED = /^(\d{2,5})[-_ ]/

/** Title from the first markdown heading, else the file name. */
/** The first line matching `test`, cut to MAX_LINE, so every regex below runs on a bounded line. */
function firstLine(text: string, test: RegExp): string | undefined {
  return text.split('\n').find(l => test.test(l))?.slice(0, MAX_LINE)
}

export function titleOf(text: string, fallback: string): string {
  const h = firstLine(text, /^#[ \t]+\S/)?.match(/^#[ \t]+(.*?)[ \t]*$/)
  if (h?.[1]) return h[1].replace(/^(ADR|SPEC|US|BUG|EP)-?\d+[ \t]*[:.\-–—]?[ \t]*/i, '').trim()
  const fm = firstLine(text, /^title:/)?.match(/^title:[ \t]*["']?(.*?)["']?[ \t]*$/)
  if (fm?.[1]) return fm[1].trim()

  return fallback
}

/** Status from `**Status**: x`, `> **Estado:** x`, `Status: x` or frontmatter `status: x`. */
export function statusOf(text: string): string {
  // Each alternative runs on one bounded line with bounded whitespace classes: the cost is
  // linear in MAX_LINE whatever the file holds (a 64 KiB whitespace run used to backtrack cubically).
  const bold = firstLine(text, /\*\*(?:status|estado)/i)?.match(
    /\*\*(?:status|estado)[ \t]{0,8}:?[ \t]{0,8}\*\*[ \t]{0,8}:?[ \t]{0,8}\*{0,2}[ \t]{0,8}([A-Za-z][A-Za-z _-]{0,60})/i,
  )
  const plain = bold ?? firstLine(text, /^(?:status|estado)[ \t]*:/i)?.match(/^(?:status|estado)[ \t]{0,8}:[ \t]{0,8}["']?([A-Za-z][A-Za-z _-]{0,60})/i)

  return (plain?.[1] ?? '').trim().toLowerCase()
}

function slugWords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/\.md$/, '')
    .split(/[^a-z0-9]+/)
    .filter(w => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w))
}

const STOP = new Set(['spec', 'specs', 'proposal', 'readme', 'index', 'docs', 'adr', 'with', 'from', 'that', 'this', 'into', 'over', 'phase', 'story', 'stories', 'ticket', 'tickets', 'change', 'changes'])

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; isLink?: boolean }

async function listGlob($: FsDollar, root: string, pattern: string, budget: { left: number }, cache: Map<string, Entry[]>): Promise<string[]> {
  // Every segment, literal or wildcard, is resolved from a directory listing, so a symlinked
  // directory or file is skipped wherever it sits in the path, not only under a `*`.
  const listDir = async (rel: string): Promise<Entry[]> => {
    const hit = cache.get(rel)
    if (hit) return hit
    if (budget.left <= 0) return []
    budget.left--
    const entries = (await $.fs.list(join(root, rel)).catch(() => [])).filter(e => e.isLink !== true && safeName(e.name))
    cache.set(rel, entries)

    return entries
  }
  const parts = pattern.split('/')
  let paths = ['']
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] ?? ''
    const last = i === parts.length - 1
    const next: string[] = []
    for (const base of paths) {
      const entries = await listDir(base)
      if (part === '*') {
        for (const e of entries) {
          if (e.name.startsWith('.') && !last) continue
          if (last ? e.kind !== 'other' : e.kind === 'dir') next.push(joinRel(base, e.name))
        }
      } else if (part === '*.md') {
        for (const e of entries) if (e.kind === 'file' && e.name.endsWith('.md') && !/^(readme|index|template)\.md$/i.test(e.name)) next.push(joinRel(base, e.name))
      } else {
        const e = entries.find(x => x.name === part)
        if (e && (last ? e.kind !== 'other' : e.kind === 'dir')) next.push(joinRel(base, part))
      }
    }
    paths = next
    if (paths.length === 0) break
  }

  return paths
}

/** A directory entry name the scan will follow: no separators, no traversal, no control characters. */
function safeName(name: string): boolean {
  return name !== '.' && name !== '..' && !/[\/\\\u0000-\u001f]/.test(name)
}

function join(root: string, rel: string): string {
  return rel ? `${root}/${rel}` : root
}

function joinRel(base: string, name: string): string {
  return base ? `${base}/${name}` : name
}

export function idFor(kind: ObjectiveKind, rel: string, text: string): string {
  const name = rel.split('/').pop() ?? rel
  const dir = rel.split('/').slice(-2, -1)[0] ?? ''
  const inName = name.match(ID_IN_NAME) ?? dir.match(ID_IN_NAME)
  if (inName?.[1] && inName[2]) return `${inName[1].toUpperCase()}-${inName[2]}`
  const inText = text.match(/^#\s+((?:ADR|SPEC|US|BUG|EP)-?\d+)/im)
  if (inText?.[1]) return inText[1].toUpperCase().replace(/^([A-Z]+)(\d)/, '$1-$2')
  const numbered = name.match(NUMBERED)
  if (kind === 'adr' && numbered) return `ADR-${numbered[1]}`
  if (kind === 'openspec-change') return `openspec:${dir}`
  if (kind === 'openspec-spec') return `capability:${dir}`
  if (kind === 'gsd-phase') return `phase:${name}`
  if (kind === 'spec') return `spec:${name === 'spec.md' || name === 'SPEC.md' ? dir : name.replace(/\.md$/, '')}`

  return `${kind}:${name.replace(/\.md$/, '')}`
}

async function readHead($: FsDollar, path: string): Promise<string> {
  const text = await $.fs.read(path).catch(() => '')

  return text.length > MAX_READ ? text.slice(0, MAX_READ) : text
}

/** A GSD phase directory: `SUMMARY.md` means done, `PLAN.md` in progress, else planned. */
async function gsdPhase($: FsDollar, root: string, rel: string): Promise<RepoObjective> {
  const entries = await $.fs.list(join(root, rel)).catch(() => [])
  const names = new Set(entries.map(e => e.name.toUpperCase()))
  const has = (n: string) => [...names].some(x => x.startsWith(n))
  const status = has('SUMMARY') ? 'done' : has('PLAN') ? 'in-progress' : 'planned'
  const name = rel.split('/').pop() ?? rel
  const plan = has('PLAN') ? await readHead($, `${root}/${rel}/${entries.find(e => e.name.toUpperCase().startsWith('PLAN'))?.name ?? 'PLAN.md'}`) : ''

  return {
    id: `phase:${name}`,
    kind: 'gsd-phase',
    title: titleOf(plan, name.replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ')),
    status,
    phase: normalizeStatus(status),
    path: rel,
    keys: [`phase:${name}`.toLowerCase(), ...slugWords(name)],
  }
}

export async function scanObjectives($: FsDollar, root: string, branch: string | null, now: number): Promise<ObjectiveCatalog> {
  const budget = { left: MAX_FILES }
  const cache = new Map<string, Entry[]>()
  const items: RepoObjective[] = []
  const seen = new Set<string>()
  for (const src of SOURCES) {
    if (items.length >= MAX_ITEMS) break
    const rels = await listGlob($, root, src.pattern, budget, cache)
    for (const rel of rels) {
      if (items.length >= MAX_ITEMS) break
      if (seen.has(rel)) continue
      seen.add(rel)
      if (src.kind === 'gsd-phase') {
        items.push(await gsdPhase($, root, rel))
        continue
      }
      const text = await readHead($, join(root, rel))
      const id = idFor(src.kind, rel, text)
      const status = statusOf(text) || (rel.includes('/archive/') ? 'archived' : src.kind === 'openspec-change' ? 'open' : '')
      const name = rel.split('/').pop() ?? rel
      const dir = rel.split('/').slice(-2, -1)[0] ?? ''
      const keys = [id.toLowerCase(), ...slugWords(name), ...(name === 'spec.md' || name === 'SPEC.md' || name === 'proposal.md' ? slugWords(dir) : [])]
      items.push({
        id,
        kind: src.kind,
        title: titleOf(text, name.replace(/\.md$/, '')),
        status: status || 'unknown',
        phase: normalizeStatus(status),
        path: rel,
        keys: [...new Set(keys)],
      })
    }
  }

  return { root, branch, scannedAt: now, items }
}

/** Objective ids an agent relates to, by what it says, the files it touched and the branch it runs on. */
export function matchObjectives(catalog: ObjectiveCatalog, agent: { description: string; task: string; files: string[] }): { id: string; via: 'text' | 'file' | 'branch' }[] {
  const text = `${agent.description} ${agent.task}`.toLowerCase()
  const branch = (catalog.branch ?? '').toLowerCase()
  const out: { id: string; via: 'text' | 'file' | 'branch' }[] = []
  for (const o of catalog.items) {
    const idKey = o.id.toLowerCase()
    const idHit = text.includes(idKey) || (o.id.includes('-') && new RegExp(`\\b${escapeRe(o.id)}\\b`, 'i').test(text))
    const slugHits = o.keys.filter(k => k !== idKey && k.length >= 5 && text.includes(k)).length
    if (idHit || slugHits >= 2) {
      out.push({ id: o.id, via: 'text' })
      continue
    }
    const dir = o.path.endsWith('.md') ? o.path.slice(0, o.path.lastIndexOf('/')) : o.path
    const fileHit = agent.files.some(f => {
      const rel = f.startsWith(catalog.root) ? f.slice(catalog.root.length + 1) : f

      return rel === o.path || (dir && rel.startsWith(`${dir}/`) && (o.kind === 'openspec-change' || o.kind === 'gsd-phase' || o.kind === 'spec'))
    })
    if (fileHit) {
      out.push({ id: o.id, via: 'file' })
      continue
    }
    if (branch && (branch.includes(idKey) || (o.id.includes('-') && new RegExp(`\\b${escapeRe(o.id)}\\b`, 'i').test(branch)))) out.push({ id: o.id, via: 'branch' })
  }

  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** True when a written or edited path is under one of the artifact folders, so the catalog is stale. */
export function touchesArtifacts(path: string): boolean {
  return /(^|\/)(docs\/(adr|decisions|specs|architecture\/decisions)|adr|specs|openspec|\.planning|conclave\/(sprints|product)|scrum\/tickets)(\/|$)/.test(path)
}

export function summarize(catalog: ObjectiveCatalog): Record<ObjectiveKind, { total: number; open: number; active: number; done: number; dropped: number }> {
  const out = {} as Record<ObjectiveKind, { total: number; open: number; active: number; done: number; dropped: number }>
  for (const o of catalog.items) {
    const b = (out[o.kind] ??= { total: 0, open: 0, active: 0, done: 0, dropped: 0 })
    b.total++
    if (o.phase === 'open' || o.phase === 'unknown') b.open++
    else if (o.phase === 'active') b.active++
    else if (o.phase === 'done') b.done++
    else b.dropped++
  }

  return out
}
