#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// GHSA-fc5q-39xc-vjpf (picomatch ReDoS) has no patched release yet. It is
// reachable only through next-intl's build-time file watcher (@parcel/watcher),
// never from request handling. Drop this exception as soon as the advisory
// publishes a fixed picomatch version.
const ALLOWED_ADVISORIES = new Set([
  'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
])

function runAudit() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  try {
    return execFileSync(npm, ['audit', '--omit=dev', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } catch (error) {
    // npm audit exits 1 whenever it finds a vulnerability; the JSON is on stdout.
    return typeof error.stdout === 'string' ? error.stdout : ''
  }
}

const reportFile = process.argv[2]
let report
try {
  report = JSON.parse(reportFile ? readFileSync(reportFile, 'utf8') : runAudit())
} catch {
  console.error('Production audit did not produce a readable vulnerability report.')
  process.exit(1)
}

if (!report?.vulnerabilities) {
  console.error('Production audit did not produce a vulnerability report.')
  process.exit(1)
}

const unexpected = []
for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
  for (const via of vulnerability.via || []) {
    if (
      via &&
      typeof via === 'object' &&
      (via.severity === 'high' || via.severity === 'critical') &&
      !ALLOWED_ADVISORIES.has(via.url)
    ) {
      unexpected.push(`${name}: ${via.severity} ${via.url}`)
    }
  }
}

if (unexpected.length > 0) {
  console.error('Unallowlisted high/critical advisories:')
  console.error(unexpected.join('\n'))
  process.exit(1)
}

console.log('Production audit passed (only the unfixable picomatch advisory is allowed).')
