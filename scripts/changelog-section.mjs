#!/usr/bin/env node
// Prints the CHANGELOG.md section for one version, for release notes.
//
//   node scripts/changelog-section.mjs 0.4.0-beta.1
//
// The section starts at the heading `## [<version>]` and ends before the next `## [` heading.
import { readFileSync } from 'node:fs'

const version = process.argv[2]
if (!version) {
  console.error('usage: changelog-section.mjs <version>')
  process.exit(2)
}
const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split('\n')
const start = lines.findIndex(l => l.startsWith(`## [${version}]`))
if (start < 0) process.exit(1)
let end = lines.findIndex((l, i) => i > start && l.startsWith('## ['))
if (end < 0) end = lines.length
process.stdout.write(lines.slice(start + 1, end).join('\n').trim() + '\n')
