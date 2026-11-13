import type { Strings } from './i18n'
import { base, clip, str, workflowName } from './text'

/** One line, in the configured language, saying what a tool call does. */
export function describeTool(tool: string, input: Record<string, unknown>, t: Strings): string {
  const file = str(input.file_path) ?? str(input.filePath) ?? str(input.path)
  const pattern = str(input.pattern)
  switch (tool) {
    case 'Read':
      return t.reading(base(file ?? '?'), input.offset ? String(input.offset) : undefined)
    case 'Edit':
      return t.editing(base(file ?? '?'))
    case 'Write':
      return t.writing(base(file ?? '?'))
    case 'NotebookEdit':
      return t.editingNotebook(base(file ?? '?'))
    case 'Grep':
      return t.searching(clip(pattern ?? '?', 30), file ? base(file) : undefined)
    case 'Glob':
      return t.listingFiles(clip(pattern ?? '', 30))
    case 'Bash':
      return str(input.description) ? t.running(clip(String(input.description), 60)) : t.runningCmd(clip(str(input.command) ?? '', 50))
    case 'WebFetch':
      return t.fetching(clip(str(input.url) ?? '', 50))
    case 'WebSearch':
      return t.webSearching(clip(str(input.query) ?? '', 40))
    case 'Agent':
      return t.launchingAgent(clip(str(input.description) ?? 'subagent', 50))
    case 'Workflow':
      return t.launchingWorkflow(workflowName(str(input.script), str(input.name), t.defaultRun))
    case 'SendMessage':
      return t.messaging(clip(str(input.to) ?? 'agent', 30))
    case 'TodoWrite':
    case 'TaskCreate':
    case 'TaskUpdate':
      return t.organizingTasks
    case 'LSP':
      return t.lsp(str(input.operation) ?? '?', base(file ?? '?'))
    case 'Skill':
      return t.loadingSkill(str(input.skill) ?? '')
    case 'AskUserQuestion':
      return t.waitingAnswer
    case 'Monitor':
      return t.monitoring(clip(str(input.description) ?? '', 50))
    case 'StructuredOutput':
      return t.structuredOutput
    default:
      if (tool.startsWith('mcp__')) {
        const parts = tool.split('__')
        return t.usingMcp(parts[2] ?? tool, parts[1] ?? 'MCP')
      }
      return t.using(tool)
  }
}

