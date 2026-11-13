import { expect, test } from 'claude-code/testing'

import type { RackAgent } from '../types'
import { describeTool } from '../hooks/describe'
import { ticketsOf } from '../hooks/history'
import { strings } from '../hooks/i18n'
import { idFor, matchObjectives, normalizeStatus, statusOf, titleOf, touchesArtifacts } from '../hooks/objectives'
import { priceOf, usdOf } from '../hooks/pricing'
import { fit, spark, wrap } from '../hooks/rack-client'
import { base, clip, sanitize, workflowName } from '../hooks/text'
import { cell, isTicketKey, table } from '../hooks/history'

// Headers copied from real repos (ssd-project, flowstore) and from the conclave story template.
const ADR_006 = `# ADR-006: Three-Wave Autonomous Delivery Loop on \`/conclave-dev\`, Without Auto-Merge

- **Status**: accepted
- **Date**: 2026-07-26
`
const SPEC_BOARD = `# A Visual Kanban Board for the Team's \`conclave/\` State

> **Estado:** DRAFT

## 1. Objetivo
`
const STORY = `---
id: "US-023"
title: "Export the board as PDF"
priority: "should"
status: in-progress                 # backlog | ready | in-progress | review | verified | done | retired
epic: "EP-004"
---

# US-023 Export the board as PDF
`
const OPENSPEC = `## Why

Billing is manual today.

## What Changes

- Add invoices
`
const ADR_NADR = `# 0007. Use event sourcing for orders

Date: 2026-03-02

## Status

Superseded by ADR-0009
`

test('status lines in every house style normalize to one phase', () => {
  expect(statusOf(ADR_006)).toBe('accepted')
  expect(statusOf(SPEC_BOARD)).toBe('draft')
  expect(statusOf(STORY)).toBe('in-progress')
  expect(statusOf(OPENSPEC)).toBe('')
  expect(normalizeStatus('accepted')).toBe('done')
  expect(normalizeStatus('DRAFT')).toBe('open')
  expect(normalizeStatus('in-progress')).toBe('active')
  expect(normalizeStatus('In Progress')).toBe('active')
  expect(normalizeStatus('superseded')).toBe('dropped')
  expect(normalizeStatus('archived')).toBe('done')
  expect(normalizeStatus('')).toBe('unknown')
  expect(normalizeStatus('weird')).toBe('unknown')
})

test('ids come from the file name first, then the heading, then the kind', () => {
  expect(idFor('adr', 'docs/adr/ADR-006-three-wave.md', ADR_006)).toBe('ADR-006')
  expect(idFor('adr', 'docs/adr/0007-use-event-sourcing.md', ADR_NADR)).toBe('ADR-0007')
  expect(idFor('spec', 'docs/specs/conclave-board/spec.md', SPEC_BOARD)).toBe('spec:conclave-board')
  expect(idFor('spec', 'docs/specs/payments.md', '')).toBe('spec:payments')
  expect(idFor('story', 'conclave/sprints/SPRINT-003/stories/US-023-export-pdf.md', STORY)).toBe('US-023')
  expect(idFor('epic', 'conclave/product/epics/EP-004-reporting.md', '')).toBe('EP-004')
  expect(idFor('openspec-change', 'openspec/changes/add-billing/proposal.md', OPENSPEC)).toBe('openspec:add-billing')
  expect(idFor('openspec-spec', 'openspec/specs/billing/spec.md', '')).toBe('capability:billing')
  expect(idFor('ticket', 'scrum/tickets/T-12-login.md', '')).toBe('T-12')
})

test('titles drop the id prefix and fall back to the file name', () => {
  expect(titleOf(ADR_006, 'x')).toBe('Three-Wave Autonomous Delivery Loop on `/conclave-dev`, Without Auto-Merge')
  expect(titleOf(STORY, 'x')).toBe('Export the board as PDF')
  expect(titleOf(OPENSPEC, 'add-billing')).toBe('add-billing')
  expect(titleOf('---\ntitle: "From frontmatter"\n---\n', 'x')).toBe('From frontmatter')
})

const agent = (description: string, task = '', files: string[] = []): Pick<RackAgent, 'description' | 'task' | 'files'> => ({ description, task, files })

const CATALOG = {
  root: '/repo',
  branch: 'feat/US-023-export-pdf',
  scannedAt: 0,
  items: [
    { id: 'ADR-006', kind: 'adr' as const, title: 'Three-Wave', status: 'accepted', phase: 'done' as const, path: 'docs/adr/ADR-006-three-wave.md', keys: ['adr-006', 'three', 'wave', 'autonomous', 'delivery', 'loop'] },
    { id: 'spec:conclave-board', kind: 'spec' as const, title: 'Board', status: 'draft', phase: 'open' as const, path: 'docs/specs/conclave-board/spec.md', keys: ['spec:conclave-board', 'conclave', 'board'] },
    { id: 'US-023', kind: 'story' as const, title: 'Export', status: 'in-progress', phase: 'active' as const, path: 'conclave/sprints/SPRINT-003/stories/US-023-export-pdf.md', keys: ['us-023', 'export'] },
  ],
}

test('agents match objectives by id, by two slug words, by touched files and by branch', () => {
  expect(matchObjectives(CATALOG, agent('implement the ADR-006 waves'))).toEqual([{ id: 'ADR-006', via: 'text' }, { id: 'US-023', via: 'branch' }])
  expect(matchObjectives(CATALOG, agent('refine the conclave board layout')).map(m => m.id)).toContain('spec:conclave-board')
  expect(matchObjectives(CATALOG, agent('only one word: board')).map(m => m.id)).not.toContain('spec:conclave-board')
  expect(matchObjectives(CATALOG, agent('edit', '', ['/repo/docs/specs/conclave-board/design.md']))).toEqual([{ id: 'spec:conclave-board', via: 'file' }, { id: 'US-023', via: 'branch' }])
  expect(matchObjectives({ ...CATALOG, branch: null }, agent('nothing related'))).toEqual([])
})

test('writes under artifact folders mark the catalog stale, others do not', () => {
  expect(touchesArtifacts('docs/adr/ADR-007-x.md')).toBe(true)
  expect(touchesArtifacts('/repo/openspec/changes/x/tasks.md')).toBe(true)
  expect(touchesArtifacts('.planning/phases/03-auth/PLAN.md')).toBe(true)
  expect(touchesArtifacts('conclave/sprints/SPRINT-001/stories/US-001.md')).toBe(true)
  expect(touchesArtifacts('scrum/tickets/T-1.md')).toBe(true)
  expect(touchesArtifacts('src/app/page.tsx')).toBe(false)
  expect(touchesArtifacts('docs/README.md')).toBe(false)
})

test('tool calls read as one plain line, in both languages', () => {
  const en = strings('en')
  const es = strings('es')
  expect(describeTool('Read', { file_path: '/repo/src/auth/verify.ts', offset: 120 }, en)).toBe('Reading auth/verify.ts from line 120')
  expect(describeTool('Read', { file_path: '/repo/src/auth/verify.ts' }, es)).toBe('Leyendo auth/verify.ts')
  expect(describeTool('Grep', { pattern: 'verifyToken', path: '/repo/src' }, en)).toBe('Searching "verifyToken" in repo/src')
  expect(describeTool('Grep', { pattern: 'x' }, es)).toBe('Buscando "x" en el repo')
  expect(describeTool('Bash', { command: 'npm test', description: 'Run the unit tests' }, en)).toBe('Running: Run the unit tests')
  expect(describeTool('Bash', { command: 'npm test' }, es)).toBe('Corriendo `npm test`')
  expect(describeTool('Agent', { description: 'review:bugs', prompt: '...' }, en)).toBe('Launching agent: review:bugs')
  expect(describeTool('Workflow', { script: "export const meta = { name: 'review-changes', description: 'x' }" }, en)).toBe('Launching workflow review-changes')
  expect(describeTool('mcp__claude_ai_Atlassian__getJiraIssue', {}, en)).toBe('Using getJiraIssue from claude_ai_Atlassian')
  expect(describeTool('SomethingNew', {}, es)).toBe('Usando SomethingNew')
  expect(describeTool('AskUserQuestion', {}, es)).toBe('Esperando una respuesta tuya')
})

test('prices resolve by model family and version, and cost sums the four token kinds', () => {
  expect(priceOf('claude-haiku-5-5')).toEqual([0.1, 0.5, 0.01, 0.2])
  expect(priceOf('claude-sonnet-5-5')).toEqual([2, 10, 0.1, 4])
  expect(priceOf('claude-opus-5-5')).toEqual([4, 20, 0.2, 8])
  expect(priceOf('claude-fable-5-1')).toEqual([10, 50, 0.25, 20])
  expect(priceOf('claude-fable-5-2')).toEqual([8, 40, 0.2, 16])
  expect(priceOf('claude-opus-4-7')).toEqual([5, 25, 0.5, 10])
  expect(priceOf('sonnet')).toEqual([2, 10, 0.1, 4])
  expect(priceOf('gpt-5')).toBeUndefined()
  const a = { model: 'claude-sonnet-5-5', input: 1_000_000, output: 100_000, cacheRead: 2_000_000, cacheWrite: 500_000 } as RackAgent
  expect(Math.abs((usdOf(a) ?? 0) - (2 + 1 + 0.2 + 2)) < 1e-6).toBe(true)
  expect(usdOf({ ...a, model: 'unknown-model' })).toBeNull()
})

test('ticket keys are found once each, in order, and only in the Jira shape', () => {
  expect(ticketsOf('implement MH-1234 then MH-1235 and MH-1234 again', 'see ENG-42')).toEqual(['MH-1234', 'MH-1235', 'ENG-42'])
  expect(ticketsOf('no tickets here, just ISO-8601 dates and SHA-1')).toEqual(['ISO-8601', 'SHA-1'])
  expect(ticketsOf('lowercase mh-12 is not a key')).toEqual([])
})

test('text helpers wrap, fit and clip without losing the ellipsis', () => {
  expect(wrap('one two three four five six', 9, 2)).toEqual(['one two  ', 'three…   '])
  expect(wrap('abcdefghijklmnop corto', 10, 2)).toEqual(['abcdefghij', 'klmnop…   '])
  expect(wrap('x\ny  z', 6, 2)).toEqual(['x y z ', '      '])
  expect(wrap('', 5, 2)).toEqual(['     ', '     '])
  expect(wrap('hola', 5, 0)).toEqual([])
  expect(fit('hello', 8)).toBe('hello   ')
  expect(fit('hello world', 8)).toBe('hello w…')
  expect(fit('x', 0)).toBe('')
  expect(clip('  a   b\n\nc  ', 10)).toBe('a b c')
  expect(clip('abcdefghij', 5)).toBe('abcd…')
  expect(base('/a/b/c/d.ts')).toBe('c/d.ts')
  expect(base('d.ts')).toBe('d.ts')
  expect(workflowName(undefined, undefined, 'workflow')).toBe('workflow')
  expect(workflowName('export const meta = {\n  name: "x-y",\n', undefined, 'workflow')).toBe('x-y')
  expect(workflowName('whatever', 'named', 'workflow')).toBe('named')
  expect(spark([], 4, 0, false)).toBe('▁▁▁▁')
  expect(spark([1, 2, 4, 8], 4, 0, true)).toBe('▁▂▄█')
  expect(spark([5], 3, 0, true)).toBe('▁▁█')
})

test('statusOf and titleOf stay linear on pathological inputs (audit run-1)', () => {
  const t0 = Date.now()
  expect(statusOf('# ADR-009\n\n- **Status**' + ' '.repeat(65000) + '\n')).toBe('')
  expect(statusOf('# x\n\n- **Estado**' + '\t'.repeat(65000) + 'draft\n')).toBe('')
  expect(titleOf('#' + ' '.repeat(65000) + '\n', 'fallback')).toBe('fallback')
  expect(titleOf('# ' + 'a'.repeat(65000) + '\n', 'x').length).toBe(298)
  expect(Date.now() - t0 < 500).toBe(true)
  expect(statusOf('- **Status**: accepted' + ' '.repeat(60000))).toBe('accepted')
  expect(statusOf('> **Estado:** DRAFT')).toBe('draft')
  expect(statusOf('status: in-progress   # comment')).toBe('in-progress')
})

test('sanitize drops terminal control, bidi and zero-width characters and clip applies it', () => {
  const nasty = 'ok\u001b[2K\u001b]0;owned\u0007 \u009b31m \u202erev\u200b end'
  expect(sanitize(nasty)).toBe('ok[2K]0;owned 31m rev end')
  expect(clip(nasty, 60)).toBe('ok[2K]0;owned 31m rev end')
  expect(clip('tabs\tand\nnewlines keep spacing', 60)).toBe('tabs and newlines keep spacing')
})

test('report table cells escape pipes and line breaks and drop control characters', () => {
  expect(cell('Ambient view | DONE\n# injected')).toBe('Ambient view \\| DONE # injected')
  expect(cell('\u001b[31mred')).toBe('[31mred')
  const md = table(['a', 'b'], [['x|y', 'line1\nline2']])
  expect(md.split('\n').length).toBe(3)
  expect(md).toContain('| x\\|y | line1 line2 |')
})

test('isTicketKey accepts exactly one Jira-shaped key', () => {
  expect(isTicketKey('MH-1234')).toBe(true)
  expect(isTicketKey('mh-1')).toBe(false)
  expect(isTicketKey('MH-1 OR 1=1')).toBe(false)
  expect(isTicketKey('../../etc')).toBe(false)
})
