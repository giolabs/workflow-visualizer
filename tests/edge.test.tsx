import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  plugin: 'workflow-visualizer',
  component: 'Pane',
  requestId: 'workflow-visualizer',
  props: { title: 'Workflow Visualizer', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
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

const RUN = (args: string) => ({ command: 'wv', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const

/** The engine beneath the plugin: clock, session, store, an empty repo, no git. */
function world(on: On, extra: Partial<{ store: Record<string, unknown>; fs: false }> = {}) {
  on('command.register', () => ({ value: { command: 'wv' } }))
  mock.clock(on, { now: 1_700_000_000_000 })
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('session.id', () => ({ value: 'sess-live' }))
  on('session.cwd', () => ({ value: '/repo' }))
  on('session.repo', () => ({ value: null }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, percent: 12 }, rateLimits: [], cost: { usd: 1.5 } } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  if (extra.fs !== false) {
    on('fs.list', () => ({ value: [] }))
    on('fs.exists', () => ({ value: false }))
    on('fs.read', () => ({ value: '' }))
  }
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'fatal: not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  mock.store(on, extra.store)
}

test('a denied spawn leaves no tile', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ deny: 'no agents today' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  const spawned = await $.agent.spawn(SPAWN)
  expect(spawned.deny).toBe('no agents today')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /0 servers/, in: 'rack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /reader/, in: 'rack' })).toBeUndefined()
  await ui.unmount()
})

test('an agent that ends in error shows FAIL and reports a failed run', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag-err' }))
  on('turn.complete', () => ({ text: '' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn(SPAWN)
  await $.turn.complete({ answer: '', durationMs: 1_000, isAborted: false, turnId: 't1', agentId: 'ag-err', reason: 'error' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /FAIL/, in: 'rack' })).toBeDefined()
  await ui.unmount()

  const report = await $.command.run(RUN('report all'))
  expect(report.text).toMatch(/\(0 ok \/ 1 fail\)/)
})

test('a Jira tool error keeps the bare key and never throws into the hooks', async ($, on) => {
  world(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag-j' }))
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: 'Server not connected: authenticate first' }], isError: true } }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, description: 'fix MH-77 crash' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.resize({ columns: 100, rows: 30, in: 'rack' })
  await ui.key({ key: 'right', in: 'rack' })
  await ui.key({ key: 'return', in: 'rack' })
  expect(await ui.find({ type: 'Text', text: /MH-77/, in: 'rack' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /not in Jira yet/, in: 'rack' })).toBeDefined()
  await ui.unmount()

  const jira = await $.command.run(RUN('jira'))
  expect(jira.text).toMatch(/unavailable/)
  expect(jira.text).toMatch(/\/mcp/)
})

test('a history record from an older version, missing fields, still reports', async ($, on) => {
  world(on, {
    store: {
      'history:sess-old': {
        sessionId: 'sess-old',
        cwd: '/repo',
        repo: null,
        startedAt: 1_699_000_000_000,
        updatedAt: 1_699_000_100_000,
        runs: [],
        agents: [
          // No `tickets`, no `objectives`, no `usd`: what 0.2.x wrote.
          { id: 'o1', runKey: 'solo', runName: 'standalone agents', description: 'old', type: 'x', model: 'claude-haiku-5-5', status: 'done', startedAt: 1_699_000_000_000, endedAt: 1_699_000_010_000, input: 10, output: 5, cacheRead: 0, cacheWrite: 0, steps: 1, tools: 0 },
        ],
      },
      'history:garbage': 'not a session at all',
    },
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const report = await $.command.run(RUN('report all'))
  expect(report.text).toMatch(/agents: \*\*1\*\*/)
  expect(report.text).toMatch(/\| haiku \| 1 \|/)
})

test('the agent cap never drops a live agent', async ($, on) => {
  world(on)
  let n = 0
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: `ag-${n++}` }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 61; i++) await $.agent.spawn({ ...SPAWN, tool_use_id: `tu-${i}`, description: `worker ${i}` })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /61 servers/, in: 'rack' })).toBeDefined()
  await ui.unmount()
})

test('with no git and no artifacts, objectives says so instead of failing', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const out = await $.command.run(RUN('objectives rescan'))
  expect(out.text).toMatch(/No objective artifacts in \/repo/)
})

test('/wv forgives typos, points config to /config and hands plain-word requests to the model', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const typo = await $.command.run(RUN('objetives'))
  expect(typo.text).toMatch(/No objective artifacts/)
  expect(typo.text).toMatch(/read as "objectives"/)
  expect(typo.isTextDisplayOnly).toBe(true)

  const cfg = await $.command.run(RUN('cofig'))
  expect(cfg.text).toMatch(/\/config → workflow-visualizer/)

  const ask = await $.command.run(RUN('Ver los tickets del ADR-050 que esten en backlog'))
  expect(ask.text).toMatch(/Handing your request/)
  expect(ask.isTextDisplayOnly).toBeUndefined()
  expect(ask.context?.[0]).toMatch(/ADR-050/)
  expect(ask.context?.[0]).toMatch(/\/wv objectives/)

  const unknown = await $.command.run(RUN('whatever'))
  expect(unknown.text).toMatch(/Unknown subcommand "whatever"/)

  const open = await $.command.run(RUN(''))
  expect(open.text).toBe('Workflow Visualizer opened.')
})

test('a symlinked artifact directory is not followed and a bad jiraProject disables sprint metrics', { options: { jiraProject: 'MH OR 1=1' } }, async ($, on) => {
  world(on, { fs: false })
  on('fs.list', (_, e) => {
    const p = e.path ?? '/repo'
    if (p === '/repo') return { value: [{ name: 'docs', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (p === '/repo/docs') return { value: [{ name: 'adr', kind: 'dir', size: 0, mtimeMs: 0, isLink: true }, { name: 'specs', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (p === '/repo/docs/adr') return { value: [{ name: 'ADR-001-x.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
    if (p === '/repo/docs/specs') return { value: [{ name: '..', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }, { name: 'ok-spec', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }
    if (p === '/repo/docs/specs/ok-spec') return { value: [{ name: 'spec.md', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }

    return { value: [] }
  })
  on('fs.exists', (_, e) => ({ value: e.path === '/repo/docs/specs/ok-spec/spec.md' }))
  on('fs.read', () => ({ value: '# Ok spec\n\n> **Estado:** DRAFT\n' }))
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const out = await $.command.run(RUN('objectives rescan'))
  expect(out.text).toMatch(/spec:ok-spec/)
  expect(out.text).not.toMatch(/ADR-001/)

  const jira = await $.command.run(RUN('jira'))
  expect(jira.text).toMatch(/not set/)
})

test('the JQL quotes the project key and a missing issue does not stop enrichment of the others', { options: { jiraProject: 'MH' } }, async ($, on) => {
  world(on)
  const jql: string[] = []
  const issues: string[] = []
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'ag-j2' }))
  on('mcp.call', (_, e) => {
    const text = (v: unknown) => ({ value: { content: [{ type: 'text', text: JSON.stringify(v) }], isError: false } })
    if (e.tool === 'getAccessibleAtlassianResources') return text([{ id: 'cloud-1', url: 'https://acme.atlassian.net' }])
    if (e.tool === 'getJiraIssue') {
      const key = String(e.args?.issueIdOrKey)
      issues.push(key)
      if (key === 'ISO-8601') return { value: { content: [{ type: 'text', text: 'Issue does not exist or you do not have permission to see it.' }], isError: true } }

      return text({ key, fields: { summary: `S ${key}`, status: { name: 'Done', statusCategory: { key: 'done' } }, issuetype: { name: 'Story' }, assignee: null, customfield_10016: 1 } })
    }
    if (e.tool === 'searchJiraIssuesUsingJql') {
      jql.push(String(e.args?.jql))

      return text({ issues: [] })
    }

    return { value: { content: [{ type: 'text', text: 'unknown tool' }], isError: true } }
  })
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ ...SPAWN, description: 'dates in ISO-8601 for MH-5' })
  await $.command.run(RUN('jira'))

  expect(jql[0]).toMatch(/project = "MH" AND sprint in openSprints\(\)/)
  expect(issues).toContain('ISO-8601')
  expect(issues).toContain('MH-5')
})
