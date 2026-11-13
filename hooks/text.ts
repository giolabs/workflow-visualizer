/** Small text helpers shared by the hooks, the tool describer and the report. */

export function workflowName(script: string | undefined, name: string | undefined, fallback: string): string {
  if (name) return name
  const hit = script?.match(/name\s*:\s*['"`]([^'"`]+)['"`]/)
  return hit?.[1] ?? fallback
}

/** The last two path segments, enough to recognize a file. */
export function base(path: string): string {
  const parts = path.split('/')
  const tail = parts.slice(-2).join('/')
  return tail || path
}

export function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
