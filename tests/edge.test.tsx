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
function world(on: On, extra: Partial<{ store: Record<string, unknown> }> = {}) {
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
  on('fs.list', () => ({ value: [] }))
  on('fs.exists', () => ({ value: false }))
  on('fs.read', () => ({ value: '' }))
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

test('/wv with an unknown subcommand opens the pane and says so', async ($, on) => {
  world(on)
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

  const out = await $.command.run(RUN('whatever'))
  expect(out.text).toBe('Workflow Visualizer opened.')
})
