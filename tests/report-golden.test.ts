import { expect, test } from 'claude-code/testing'

import { aggregate, renderReport } from '../hooks/history'
import type { HistorySession } from '../hooks/history'
import type { JiraSprint } from '../hooks/jira'
import type { ObjectiveCatalog } from '../hooks/objectives'
import { NOW, REPORT_EMPTY_EN, REPORT_EN, REPORT_ES } from './golden'

// The same fixtures tests/e2e/gen-golden.mjs renders the goldens from. Change
// both together, on purpose: a diff here is a report change someone must want.
const h = 3_600_000
const ag = (
  id: string, run: string, runName: string, desc: string, model: string, status: 'done' | 'failed',
  startAgo: number, dur: number, inp: number, out: number, cr: number, usd: number, tickets: string[] = [], objectives: string[] = [],
) => ({
  id, runKey: run, runName, description: desc, type: 'general-purpose', model, status,
  startedAt: NOW - startAgo, endedAt: NOW - startAgo + dur, input: inp, output: out, cacheRead: cr, cacheWrite: 0, steps: 4, tools: 6, usd, tickets, objectives,
})
const SESSIONS: HistorySession[] = [
  { sessionId: 's1', cwd: '/repo', repo: '/repo', startedAt: NOW - 30 * h, updatedAt: NOW - 29 * h,
    runs: [{ key: 'wf-1', name: 'review-changes', startedAt: NOW - 30 * h, endedAt: NOW - 30 * h + 113_000, agents: 3 }],
    agents: [
      ag('a1', 'wf-1', 'review-changes', 'review:bugs', 'claude-haiku-5-5', 'done', 30 * h, 40_000, 12_000, 1_500, 60_000, 0.0028),
      ag('a2', 'wf-1', 'review-changes', 'review:perf', 'claude-sonnet-5-5', 'done', 30 * h, 55_000, 20_000, 3_000, 90_000, 0.079),
      ag('a3', 'wf-1', 'review-changes', 'verify:bugs', 'claude-haiku-5-5', 'failed', 30 * h + 60_000, 15_000, 6_000, 400, 30_000, 0.0012),
    ] },
  { sessionId: 's2', cwd: '/repo', repo: '/repo', startedAt: NOW - 3 * h, updatedAt: NOW - 2 * h,
    runs: [{ key: 'wf-3', name: 'loop-mode', startedAt: NOW - 2 * h, endedAt: NOW - 1 * h, agents: 2 }],
    agents: [
      ag('b3', 'wf-3', 'loop-mode', 'spec MH-1234 ambient-view', 'claude-fable-5-1', 'done', 2 * h, 540_000, 120_000, 18_000, 900_000, 2.33, ['MH-1234'], ['ADR-006']),
      ag('b4', 'wf-3', 'loop-mode', 'implement MH-1234 phase 1/3', 'claude-sonnet-5-5', 'done', 2 * h - 600_000, 900_000, 200_000, 40_000, 1_500_000, 0.95, ['MH-1234'], ['ADR-006', 'spec:conclave-board']),
      ag('b6', 'solo', 'standalone agents', 'quick look', 'claude-haiku-5-5', 'done', 1 * h, 11_000, 9_000, 700, 27_000, 0.0014),
    ] },
]
const CATALOG: ObjectiveCatalog = { root: '/repo', branch: 'feat/ADR-006-waves', scannedAt: NOW, items: [
  { id: 'ADR-006', kind: 'adr', title: 'Three-Wave Autonomous Delivery Loop', status: 'accepted', phase: 'done', path: 'docs/adr/ADR-006-three-wave.md', keys: ['adr-006', 'three', 'wave'] },
  { id: 'spec:conclave-board', kind: 'spec', title: 'A Visual Kanban Board', status: 'draft', phase: 'open', path: 'docs/specs/conclave-board/spec.md', keys: ['spec:conclave-board', 'conclave', 'board'] },
  { id: 'openspec:add-billing', kind: 'openspec-change', title: 'Add billing', status: 'open', phase: 'open', path: 'openspec/changes/add-billing/proposal.md', keys: ['openspec:add-billing', 'billing'] },
] }
const SPRINT: JiraSprint = { project: 'MH', name: 'Sprint 42', state: 'active', goal: null, fetchedAt: NOW, issues: [
  { key: 'MH-1234', summary: 'Ambient view', status: 'In Progress', category: 'indeterminate', type: 'Story', assignee: 'Gio', points: 5, sprint: 'Sprint 42', sprintState: 'active', url: null, fetchedAt: NOW },
  { key: 'MH-1235', summary: 'Settings page', status: 'Done', category: 'done', type: 'Story', assignee: null, points: 3, sprint: 'Sprint 42', sprintState: 'active', url: null, fetchedAt: NOW },
] }
const TICKETS = { 'MH-1234': { summary: 'Ambient view', status: 'In Progress' } }
const extras = { tickets: TICKETS, sprint: SPRINT, sprintProject: 'MH', catalog: CATALOG }

test('the English report matches its golden', () => {
  expect(renderReport(aggregate(SESSIONS, 'all', NOW), 'en', extras)).toBe(REPORT_EN)
})

test('the Spanish report matches its golden', () => {
  expect(renderReport(aggregate(SESSIONS, 'all', NOW), 'es', extras)).toBe(REPORT_ES)
})

test('an empty window still renders the objectives block', () => {
  expect(renderReport(aggregate([], '7d', NOW), 'en', { catalog: { ...CATALOG, items: [] } })).toBe(REPORT_EMPTY_EN)
})

test('aggregation windows cut by end time and keep sprint-agnostic totals', () => {
  const all = aggregate(SESSIONS, 'all', NOW)
  expect(all.total.agents).toBe(6)
  expect(all.total.done).toBe(5)
  expect(all.total.failed).toBe(1)
  expect(all.byTicket.map(([k]) => k)).toEqual(['MH-1234'])
  expect(all.byObjective.map(([k]) => k)).toEqual(['ADR-006', 'spec:conclave-board'])
  expect(all.byWorkflow.map(([k, b]) => [k, b.runs])).toEqual([['loop-mode', 1], ['review-changes', 1]])
  const today = aggregate(SESSIONS, 'today', NOW)
  expect(today.total.agents).toBe(3)
  expect(today.sessions).toBe(1)
  expect(aggregate(SESSIONS, '7d', NOW).total.agents).toBe(6)
})
