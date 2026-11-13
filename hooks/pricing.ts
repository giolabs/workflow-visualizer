import type { RackAgent } from '../types'

/** USD per million tokens: [input, output, cacheRead, cacheWrite]. Claude Code
 * caches with a 1-hour TTL, so the write premium is 2x the input price.
 * List prices as of 2026-11-03. */
export type Price = [number, number, number, number]
const PRICES: [RegExp, Price][] = [
  [/fable-5-2|mythos-5-2/, [8, 40, 0.2, 16]],
  [/fable-5-1|mythos-5-1/, [10, 50, 0.25, 20]],
  [/fable-5|mythos-5/, [10, 50, 1, 20]],
  [/opus-5-5/, [4, 20, 0.2, 8]],
  [/opus-5|opus-4-[678]/, [5, 25, 0.5, 10]],
  [/sonnet-5-5/, [2, 10, 0.1, 4]],
  [/sonnet-5/, [2, 10, 0.2, 4]],
  [/sonnet-4-6/, [3, 15, 0.3, 6]],
  [/haiku-5-5/, [0.1, 0.5, 0.01, 0.2]],
  [/haiku-4-5/, [1, 5, 0.1, 2]],
  [/fable|mythos/, [8, 40, 0.2, 16]],
  [/opus/, [4, 20, 0.2, 8]],
  [/sonnet/, [2, 10, 0.1, 4]],
  [/haiku/, [0.1, 0.5, 0.01, 0.2]],
]

export function priceOf(model: string): Price | undefined {
  const m = (model ?? '').toLowerCase()

  return PRICES.find(([re]) => re.test(m))?.[1]
}

/** Estimated USD for one loop's tokens at its model's list price; null when the model is unknown. */
export function usdOf(a: RackAgent): number | null {
  const p = priceOf(a.model)
  if (!p) return null

  return (a.input * p[0] + a.output * p[1] + a.cacheRead * p[2] + a.cacheWrite * p[3]) / 1_000_000
}

