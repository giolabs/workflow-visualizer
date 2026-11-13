export type Language = 'en' | 'es'

export const LANGUAGES: readonly Language[] = ['en', 'es']

export function asLanguage(value: unknown): Language {
  return value === 'es' ? 'es' : 'en'
}

/** Every user-facing string of the plugin, keyed; the UI reads one table. */
export type Strings = {
  paneTitle: string
  commandOpen: string
  commandHint: string
  paneOpened: string
  loopStarting: (args: string) => string
  askStarting: string
  askLaunched: (request: string) => string
  launchRefused: string
  paneWaiting: (reason: string) => string
  versionLine: (version: string) => string
  interpretedAs: (sub: string) => string
  configHint: string
  unknownSubcommand: (sub: string) => string
  workflowEnters: (name: string) => string
  agentFinished: (mascot: string, desc: string, ok: boolean, dur: string, tok: string) => string
  statusLine: (n: number) => string
  orchestratorName: string
  orchestratorRole: string
  waitingForYou: string
  readingYourMessage: string
  thinking: string
  writingAnswerMain: string
  writingAnswerAgent: string
  booting: string
  bootedAs: (type: string) => string
  adoptedAs: (type: string) => string
  launched: (mascot: string, desc: string) => string
  received: (mascot: string, desc: string) => string
  failedChild: (mascot: string, desc: string) => string
  deliveredReport: string
  endedWithError: (reason: string) => string
  turnLabel: (n: number, text: string) => string
  turnContinued: (n: number) => string
  answeredYou: string
  turnAborted: string
  turnError: (reason: string) => string
  sessionStarted: string
  soloRun: string
  defaultRun: string
  sessionRun: string
  // tool descriptions
  reading: (file: string, offset?: string) => string
  editing: (file: string) => string
  writing: (file: string) => string
  editingNotebook: (file: string) => string
  searching: (pattern: string, where?: string) => string
  listingFiles: (pattern: string) => string
  running: (what: string) => string
  runningCmd: (cmd: string) => string
  fetching: (url: string) => string
  webSearching: (q: string) => string
  launchingAgent: (desc: string) => string
  launchingWorkflow: (name: string) => string
  messaging: (to: string) => string
  organizingTasks: string
  lsp: (op: string, file: string) => string
  loadingSkill: (skill: string) => string
  waitingAnswer: string
  monitoring: (what: string) => string
  structuredOutput: string
  usingMcp: (tool: string, server: string) => string
  using: (tool: string) => string
  // client
  rack: string
  servers: string
  online: string
  rackIdle: string
  sumAgents: string
  unpriced: (n: number) => string
  keysHint: string
  turn: string
  roleLabel: string
  roleText: string
  workflows: string
  agents: string
  context: string
  contextUnknown: string
  sessionReal: string
  step: string
  tools: string
  emptyTitle: string
  emptyLine1: string
  emptyLine2: string
  moreAbove: (n: number) => string
  moreBelow: (n: number) => string
  launchedCount: (n: number) => string
  cache: string
  input: string
  output: string
  steps: string
  turns: string
  taskLabel: string
  nowLabel: string
  lastActions: string
  reportLabel: string
  saidLabel: string
  ticketLabel: string
  ticketUnknown: string
  objectiveLabel: string
  branchLabel: string
  help1: string
  help2: string
  help3: string
  ranks: [string, string, string, string, string]
  leds: { work: string; think: string; write: string; idle: string; boot: string; done: string; fail: string }
}

const en: Strings = {
  paneTitle: 'Workflow Visualizer',
  commandOpen: 'Open the Workflow Visualizer; "/wv loop <tickets>" runs the loop-mode orchestration; "/wv help" lists subcommands',
  commandHint: '[loop <tickets> | report | objectives | jira | help | <free text>]',
  paneOpened: 'Workflow Visualizer opened.',
  loopStarting: args => `Starting loop-mode for: ${args || '(no tickets given: the orchestrator will ask)'}…`,
  askStarting: 'Handing your request to the orchestrator with the visualizer context…',
  askLaunched: request => `Launching the wv-ask workflow for: ${request} — 3 researchers (repo, Jira, git) + 1 synthesizer; watch them in the rack.`,
  launchRefused: 'workflow-visualizer could not start the turn:',
  paneWaiting: reason => `The rack pane is not drawn yet (${reason}); widen the terminal or run /wv to open it.`,
  versionLine: version => `workflow-visualizer ${version}`,
  interpretedAs: sub => `(read as "${sub}")`,
  configHint: 'Settings live in /config → workflow-visualizer (language, decision mode, Jira project, points field, MCP server).',
  unknownSubcommand: sub => `Unknown subcommand "${sub}". Type /wv help for the list, or write a request in plain words after /wv.`,
  workflowEnters: name => `🏟 Workflow "${name}" enters the rack`,
  agentFinished: (m, d, ok, dur, tok) => `${m} ${d} ${ok ? 'done' : 'failed'} · ${dur} · ${tok} tok`,
  statusLine: n => `🏟 ${n} in the rack`,
  orchestratorName: 'Orchestrator',
  orchestratorRole: 'Reads your messages, decides what to do, launches agents and workflows, gathers their reports and answers you.',
  waitingForYou: 'Waiting for your message',
  readingYourMessage: 'Reading your message…',
  thinking: 'Thinking…',
  writingAnswerMain: 'Writing your answer',
  writingAnswerAgent: 'Writing its answer',
  booting: 'Booting…',
  bootedAs: t => `Booted as ${t}`,
  adoptedAs: t => `Found running as ${t} (spawned outside the plugin's view)`,
  launched: (m, d) => `Launched ${m} ${d}`,
  received: (m, d) => `Received ${m} ${d}`,
  failedChild: (m, d) => `Failed ${m} ${d}`,
  deliveredReport: 'Delivered its report',
  endedWithError: r => `Ended with error (${r})`,
  turnLabel: (n, t) => `Turn ${n}: "${t}"`,
  turnContinued: n => `Turn ${n} (continued)`,
  answeredYou: 'Answered you',
  turnAborted: 'Turn interrupted',
  turnError: r => `Turn ended with error (${r})`,
  sessionStarted: 'Session up',
  soloRun: 'standalone agents',
  defaultRun: 'workflow',
  sessionRun: 'session',
  reading: (f, o) => `Reading ${f}${o ? ` from line ${o}` : ''}`,
  editing: f => `Editing ${f}`,
  writing: f => `Writing ${f}`,
  editingNotebook: f => `Editing notebook ${f}`,
  searching: (p, w) => `Searching "${p}"${w ? ` in ${w}` : ' in the repo'}`,
  listingFiles: p => `Listing files ${p}`,
  running: w => `Running: ${w}`,
  runningCmd: c => `Running \`${c}\``,
  fetching: u => `Fetching ${u}`,
  webSearching: q => `Searching the web for "${q}"`,
  launchingAgent: d => `Launching agent: ${d}`,
  launchingWorkflow: n => `Launching workflow ${n}`,
  messaging: to => `Messaging ${to}`,
  organizingTasks: 'Organizing its task list',
  lsp: (op, f) => `Querying the LSP (${op}) on ${f}`,
  loadingSkill: s => `Loading skill ${s}`,
  waitingAnswer: 'Waiting for your answer',
  monitoring: w => `Monitoring: ${w}`,
  structuredOutput: 'Delivering its structured result',
  usingMcp: (t, s) => `Using ${t} from ${s}`,
  using: t => `Using ${t}`,
  rack: 'rack',
  servers: 'servers',
  online: 'online',
  rackIdle: 'rack idle',
  sumAgents: 'Σ agents',
  unpriced: n => ` (+${n} unpriced)`,
  keysHint: '←→↑↓ enter ?',
  turn: 'turn',
  roleLabel: 'Role: ',
  roleText: 'launches agents and workflows, gathers their reports and answers you',
  workflows: 'workflows',
  agents: 'agents',
  context: 'context',
  contextUnknown: 'context ?',
  sessionReal: 'session',
  step: 'step',
  tools: 'tools',
  emptyTitle: '◌ empty rack',
  emptyLine1: 'When the orchestrator launches a Workflow or an Agent, each agent shows up as',
  emptyLine2: 'a server: status LED, what it is doing right now and what it consumes.',
  moreAbove: n => `↑ ${n} more above  `,
  moreBelow: n => `↓ ${n} more below`,
  launchedCount: n => ` · ${n} agents launched`,
  cache: 'cache',
  input: 'in',
  output: 'out',
  steps: 'steps',
  turns: 'turns',
  taskLabel: 'Task: ',
  nowLabel: 'Now:  ',
  lastActions: 'Latest actions:',
  reportLabel: 'Report: ',
  saidLabel: 'Said:   ',
  ticketLabel: 'Ticket: ',
  ticketUnknown: '(not in Jira yet)',
  objectiveLabel: 'Goal:   ',
  branchLabel: 'branch',
  help1: 'LED: ● WORK using a tool · THINK reasoning · WRITE drafting · IDLE waiting · DONE/FAIL off.',
  help2: 'Sparkline = tokens per step. $ = estimate at list price per model (1h cache); "session" comes from /cost.',
  help3: '←→↑↓/hjkl pick a server (the orchestrator is first) · enter detail · click · ? this',
  ranks: ['Ant', 'Beaver', 'Wolf', 'Elephant', 'Whale'],
  leds: { work: 'WORK', think: 'THINK', write: 'WRITE', idle: 'IDLE', boot: 'BOOT', done: 'DONE', fail: 'FAIL' },
}

const es: Strings = {
  ...en,
  commandOpen: 'Abre el Workflow Visualizer; "/wv loop <tickets>" corre la orquestación loop-mode; "/wv help" lista los subcomandos',
  paneOpened: 'Workflow Visualizer abierto.',
  loopStarting: args => `Arrancando loop-mode para: ${args || '(sin tickets: el orquestador los va a pedir)'}…`,
  askStarting: 'Pasando tu pedido al orquestador con el contexto del visualizer…',
  askLaunched: request => `Lanzando el workflow wv-ask para: ${request} — 3 investigadores (repo, Jira, git) + 1 sintetizador; miralos en el rack.`,
  launchRefused: 'workflow-visualizer no pudo arrancar el turno:',
  paneWaiting: reason => `El rack todavía no se dibuja (${reason}); ensanchá la terminal o corré /wv para abrirlo.`,
  versionLine: version => `workflow-visualizer ${version}`,
  interpretedAs: sub => `(leído como "${sub}")`,
  configHint: 'La configuración está en /config → workflow-visualizer (idioma, modo de decisión, proyecto Jira, campo de puntos, servidor MCP).',
  unknownSubcommand: sub => `Subcomando desconocido "${sub}". Tipeá /wv help para la lista, o escribí un pedido en palabras después de /wv.`,
  workflowEnters: name => `🏟 Workflow "${name}" entra al rack`,
  agentFinished: (m, d, ok, dur, tok) => `${m} ${d} ${ok ? 'listo' : 'falló'} · ${dur} · ${tok} tok`,
  statusLine: n => `🏟 ${n} en el rack`,
  orchestratorName: 'Orquestador',
  orchestratorRole: 'Lee tus mensajes, decide qué hacer, lanza agentes y workflows, junta sus reportes y te responde.',
  waitingForYou: 'Esperando tu mensaje',
  readingYourMessage: 'Leyendo tu mensaje…',
  thinking: 'Pensando…',
  writingAnswerMain: 'Escribiéndote la respuesta',
  writingAnswerAgent: 'Escribiendo su respuesta',
  booting: 'Arrancando…',
  bootedAs: t => `Encendido como ${t}`,
  adoptedAs: t => `Encontrado corriendo como ${t} (lanzado fuera de la vista del plugin)`,
  launched: (m, d) => `Lanzó ${m} ${d}`,
  received: (m, d) => `Recibió ${m} ${d}`,
  failedChild: (m, d) => `Falló ${m} ${d}`,
  deliveredReport: 'Entregó su reporte',
  endedWithError: r => `Terminó con error (${r})`,
  turnLabel: (n, t) => `Turno ${n}: "${t}"`,
  turnContinued: n => `Turno ${n} (continuación)`,
  answeredYou: 'Te respondió',
  turnAborted: 'Turno interrumpido',
  turnError: r => `Turno terminó con error (${r})`,
  sessionStarted: 'Sesión en marcha',
  soloRun: 'agentes sueltos',
  sessionRun: 'sesión',
  reading: (f, o) => `Leyendo ${f}${o ? ` desde la línea ${o}` : ''}`,
  editing: f => `Editando ${f}`,
  writing: f => `Escribiendo ${f}`,
  editingNotebook: f => `Editando notebook ${f}`,
  searching: (p, w) => `Buscando "${p}"${w ? ` en ${w}` : ' en el repo'}`,
  listingFiles: p => `Listando archivos ${p}`,
  running: w => `Corriendo: ${w}`,
  runningCmd: c => `Corriendo \`${c}\``,
  fetching: u => `Consultando ${u}`,
  webSearching: q => `Buscando en la web "${q}"`,
  launchingAgent: d => `Lanzando agente: ${d}`,
  launchingWorkflow: n => `Lanzando el workflow ${n}`,
  messaging: to => `Mandando un mensaje a ${to}`,
  organizingTasks: 'Ordenando su lista de tareas',
  lsp: (op, f) => `Consultando el LSP (${op}) en ${f}`,
  loadingSkill: s => `Cargando la skill ${s}`,
  waitingAnswer: 'Esperando una respuesta tuya',
  monitoring: w => `Monitoreando: ${w}`,
  structuredOutput: 'Entregando su resultado estructurado',
  usingMcp: (t, s) => `Usando ${t} de ${s}`,
  using: t => `Usando ${t}`,
  servers: 'servers',
  online: 'online',
  rackIdle: 'rack en reposo',
  sumAgents: 'Σ agentes',
  unpriced: n => ` (+${n} sin precio)`,
  turn: 'turno',
  roleLabel: 'Función: ',
  roleText: 'lanza agentes y workflows, junta sus reportes y te responde',
  agents: 'agentes',
  context: 'contexto',
  contextUnknown: 'contexto ?',
  sessionReal: 'sesión',
  step: 'paso',
  emptyTitle: '◌ rack vacío',
  emptyLine1: 'Cuando el orquestador lance un Workflow o un Agent, cada agente aparece como',
  emptyLine2: 'un servidor: LED de estado, qué está haciendo ahora y cuánto consume.',
  moreAbove: n => `↑ ${n} más arriba  `,
  moreBelow: n => `↓ ${n} más abajo`,
  launchedCount: n => ` · ${n} agentes lanzados`,
  steps: 'pasos',
  turns: 'turnos',
  taskLabel: 'Tarea: ',
  nowLabel: 'Ahora: ',
  lastActions: 'Últimas acciones:',
  reportLabel: 'Reporte: ',
  saidLabel: 'Dijo:    ',
  ticketLabel: 'Ticket: ',
  ticketUnknown: '(todavía sin datos de Jira)',
  objectiveLabel: 'Meta:   ',
  branchLabel: 'branch',
  help1: 'LED: ● WORK usando un tool · THINK razonando · WRITE redactando · IDLE espera · DONE/FAIL apagado.',
  help2: 'Sparkline = tokens por paso. $ = estimado a precio de lista por modelo (cache 1h); "sesión" sale de /cost.',
  help3: '←→↑↓/hjkl elegir server (el orquestador es el primero) · enter detalle · click · ? esto',
  ranks: ['Hormiga', 'Castor', 'Lobo', 'Elefante', 'Ballena'],
}

export const STRINGS: Record<Language, Strings> = { en, es }

export function strings(language: Language): Strings {
  return STRINGS[language]
}
