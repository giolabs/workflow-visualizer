// The live rack in a browser (web/server.mjs + web/index.html), for clients that attach no
// drawing surface: pure helpers the hooks module and the tests share.
import type { RackProps } from './rack-client'
import type { Strings } from './i18n'

/** The server's one stdout line: `listening http://127.0.0.1:<port> token=<token>`. */
export function parseListening(text: string): { url: string; token: string } | null {
  const m = /listening (http:\/\/127\.0\.0\.1:\d+) token=([0-9a-f]+)/.exec(text)

  return m ? { url: m[1]!, token: m[2]! } : null
}

/** What the page draws from: the pane's props and the strings of the configured language. */
export function webPayload(props: RackProps, t: Strings): string {
  return JSON.stringify({ props, labels: t })
}

/** The URL the person opens: the token travels once in it and stays as a cookie (server.mjs). */
export const webLink = (web: { url: string; token: string }): string => `${web.url}/?t=${web.token}`

/** The command that opens a URL in the person's browser, by platform. */
export const openCommands = (url: string): readonly (readonly string[])[] => [['open', url], ['xdg-open', url], ['cmd', '/c', 'start', '', url]]
