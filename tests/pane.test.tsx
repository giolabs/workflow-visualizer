import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'workflow-visualizer',
  component: 'Pane',
  requestId: 'workflow-visualizer',
  props: {
    title: 'Workflow Visualizer',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const SPAWN = {
  tool_use_id: 'tu-1',
  prompt: 'read files',
  description: 'reader',
  subagentType: 'Explore',
  provider: { plugin: 'engine', tier: 'core' },
  model: 'haiku',
  parentModel: 'claude-fable-5-1',
  background: true,
  fork: false,
} as const

function world(on: On) {
  on('command.register', () => ({ value: { command: 'wv' } }))
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 1_000_000, percent: 12 }, rateLimits: [], cost: { usd: 1.5 } },
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag-1' }))
  on('tool.call', () => ({ result: {} }))
}

test('the pane draws the orchestrator in English by default, with an empty rack', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ORCHESTRATOR/, in: 'rack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /empty rack/, in: 'rack' })).toBeDefined()
  await ui.unmount()
})

test('the language option switches the UI to Spanish', { options: { language: 'es' } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ORQUESTADOR/, in: 'rack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /rack vacío/, in: 'rack' })).toBeDefined()
  await ui.unmount()
})

test('a spawned agent shows as a tile and is counted', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /reader/, in: 'rack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1 servers/, in: 'rack' })).toBeDefined()
  await ui.unmount()
})

test('/wv loop hands the model the bundled skill with the plugin settings', { options: { autonomy: 'autonomous' } }, async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({
    command: 'wv',
    args: 'loop MH-1 MH-2',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
  expect(ran.text).toMatch(/loop-mode/)
  expect(ran.text).toMatch(/MH-1 MH-2/)
  expect(ran.text).toMatch(/autonomous/)
})

test('/wv report aggregates stored sessions and the live one', async ($, on) => {
  world(on)
  on('session.id', () => ({ value: 'sess-live' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', name: 'repo', remote: null, internal: false } }))
  const now = 1_700_000_000_000
  mock.store(on, {
    'history:sess-old': {
      sessionId: 'sess-old',
      cwd: '/repo',
      repo: '/repo',
      startedAt: now - 3_600_000,
      updatedAt: now - 3_000_000,
      runs: [{ key: 'wf-1', name: 'review-changes', startedAt: now - 3_500_000, endedAt: now - 3_100_000, agents: 1 }],
      agents: [
        {
          id: 'old-1', runKey: 'wf-1', runName: 'review-changes', description: 'review:bugs MH-12', type: 'general-purpose',
          model: 'claude-sonnet-5-5', status: 'done', startedAt: now - 3_500_000, endedAt: now - 3_100_000,
          input: 10_000, output: 2_000, cacheRead: 50_000, cacheWrite: 0, steps: 4, tools: 6, usd: 0.05, tickets: ['MH-12'],
        },
      ],
    },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const ran = await $.command.run({ command: 'wv', args: 'report all', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  expect(ran.text).toMatch(/productivity report/)
  expect(ran.text).toMatch(/review-changes/)
  expect(ran.text).toMatch(/MH-12/)
  expect(ran.text).toMatch(/sonnet/)
})

const JIRA_ISSUE = (key: string, status: string, category: 'new' | 'indeterminate' | 'done', points: number) => ({
  key,
  fields: {
    summary: `Summary of ${key}`,
    status: { name: status, statusCategory: { key: category } },
    issuetype: { name: 'Story' },
    assignee: { displayName: 'Gio' },
    customfield_10016: points,
    sprint: { name: 'Sprint 42', state: 'active' },
  },
})

function jiraWorld(on: On) {
  on('session.id', () => ({ value: 'sess-live' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', name: 'repo', remote: null, internal: false } }))
  mock.store(on)
  on('mcp.call', (_, e) => {
    const text = (v: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(v) }], isError: false } })
    if (e.tool === 'getAccessibleAtlassianResources') return text([{ id: 'cloud-1', url: 'https://acme.atlassian.net' }])
    if (e.tool === 'getJiraIssue') return text(JIRA_ISSUE(String(e.args?.issueIdOrKey), 'In Progress', 'indeterminate', 5))
    if (e.tool === 'searchJiraIssuesUsingJql') {
      return text({ issues: [JIRA_ISSUE('MH-12', 'Done', 'done', 3), JIRA_ISSUE('MH-13', 'In Progress', 'indeterminate', 5), JIRA_ISSUE('MH-14', 'To Do', 'new', 8)] })
    }

    return { value: { content: [{ type: 'text', text: 'unknown tool' }], isError: true } }
  })
}

test('an agent that names a ticket gets it enriched from Jira in its detail', { options: { jiraProject: 'MH' } }, async ($, on) => {
  world(on)
  jiraWorld(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, description: 'implement MH-13 login' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.key({ key: 'right', in: 'rack' })
  await ui.key({ key: 'return', in: 'rack' })
  expect(await ui.find({ type: 'Text', text: /MH-13/, in: 'rack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /In Progress/, in: 'rack' })).toBeDefined()
  await ui.unmount()
})

test('/wv jira and /wv report show the open sprint of the configured project', { options: { jiraProject: 'MH' } }, async ($, on) => {
  world(on)
  jiraWorld(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const run = (args: string) => $.command.run({ command: 'wv', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

  const jira = await run('jira')
  expect(jira.text).toMatch(/Sprint 42/)
  expect(jira.text).toMatch(/issues 1\/3 done/)
  expect(jira.text).toMatch(/points 3\/16/)

  const report = await run('report all')
  expect(report.text).toMatch(/Sprint objectives/)
  expect(report.text).toMatch(/MH-14/)
})

const REPO: Record<string, { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number; isLink: boolean }[]> = {
  '/repo': [{ name: 'docs', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
  '/repo/docs': [
    { name: 'adr', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
    { name: 'specs', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
  ],
  '/repo/docs/adr': [{ name: 'ADR-006-three-wave-delivery-loop.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false }],
  '/repo/docs/specs': [{ name: 'conclave-board', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }],
  '/repo/docs/specs/conclave-board': [{ name: 'spec.md', kind: 'file', size: 10, mtimeMs: 0, isLink: false }],
}
const FILES: Record<string, string> = {
  '/repo/docs/adr/ADR-006-three-wave-delivery-loop.md': '# ADR-006: Three-Wave Autonomous Delivery Loop\n\n- **Status**: accepted\n',
  '/repo/docs/specs/conclave-board/spec.md': '# A Visual Kanban Board\n\n> **Estado:** DRAFT\n',
}

function repoWorld(on: On) {
  on('session.id', () => ({ value: 'sess-live' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: { root: '/repo', name: 'repo', remote: null, internal: false } }))
  mock.store(on)
  on('fs.list', (_, e) => ({ value: REPO[e.path ?? '/repo'] ?? [] }))
  on('fs.exists', (_, e) => ({ value: e.path in FILES || e.path in REPO }))
  on('fs.read', (_, e) => ({ value: FILES[e.path] ?? '' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'feat/ADR-006-waves\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
}

test('repo ADRs and specs become objectives, matched by id in the task and by files touched', async ($, on) => {
  world(on)
  repoWorld(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, description: 'implement the ADR-006 loop' })

  const run = (args: string) => $.command.run({ command: 'wv', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
  const objectives = await run('objectives')
  expect(objectives.text).toMatch(/ADR-006/)
  expect(objectives.text).toMatch(/accepted/)
  expect(objectives.text).toMatch(/spec:conclave-board/)
  expect(objectives.text).toMatch(/draft/)
  expect(objectives.text).toMatch(/feat\/ADR-006-waves/)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 100, rows: 30, in: 'rack' })
  await ui.key({ key: 'right', in: 'rack' })
  await ui.key({ key: 'return', in: 'rack' })
  expect(await ui.find({ type: 'Text', text: /ADR-006/, in: 'rack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Three-Wave/, in: 'rack' })).toBeDefined()
  await ui.unmount()

  const report = await run('report all')
  expect(report.text).toMatch(/Repo objectives/)
  expect(report.text).toMatch(/Artifacts in the repo/)
  expect(report.text).toMatch(/\| adr \| 1 \|/)
})
