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

/** Characters a terminal or a markdown sink must never receive from untrusted text:
 * C0 and C1 controls (ESC, BEL, BS, DEL, CSI…), bidi overrides and isolates, and the
 * zero-width/line-separator family. Tabs, newlines and carriage returns are whitespace
 * and are handled by the callers' whitespace collapsing. */
const UNSAFE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g

/** Drops control, bidi-override and zero-width characters; keeps every printable one. */
export function sanitize(text: string): string {
  return text.replace(UNSAFE, '')
}

export function clip(text: string, max: number): string {
  const one = sanitize(text).replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}
