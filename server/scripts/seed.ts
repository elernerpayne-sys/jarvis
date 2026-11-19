/**
 * Loads believable sample data (three barbershops, a week of calls with
 * transcripts, appointments, coding tasks, approvals, alerts, a handbook and
 * a decisions log) so the live app isn't empty before real calls arrive.
 *
 *   npm run seed             replaces any earlier sample data with a fresh set, dated around now
 *   npm run seed -- --clear  removes the sample data and leaves everything else alone
 *
 * The rows come from the app's own demo data (src/services/demo/seed). Every
 * sample row's id starts with "sample-", which is how --clear finds them.
 * Sample repos are added to Settings → allowed repos and removed again by --clear.
 * Restart the server or reload the app afterwards to see the change.
 */
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { createBus } from '../src/bus.ts'
import { APP_ROOT, loadConfig } from '../src/config.ts'
import { openDb, transaction } from '../src/db.ts'
import type { Db } from '../src/db.ts'
import { createStore } from '../src/store.ts'

const PREFIX = 'sample-'
const TABLES = ['alerts', 'approvals', 'task_events', 'tasks', 'appointments', 'calls', 'handbook_entries', 'decisions', 'shops'] as const
const REF_FIELDS = ['shop_id', 'call_id', 'task_id', 'approval_id']

const { values } = parseArgs({ options: { clear: { type: 'boolean' } } })

function clearSamples(db: Db): number {
  let removed = 0
  for (const table of TABLES) {
    removed += Number(db.prepare(`DELETE FROM ${table} WHERE id LIKE '${PREFIX}%'`).run().changes)
  }
  const meta = db.prepare("SELECT value FROM meta WHERE key = 'sample_repos'").get() as { value: string } | undefined
  if (meta) {
    const added = JSON.parse(meta.value) as string[]
    const row = db.prepare('SELECT id, allowed_repos FROM settings LIMIT 1').get() as { id: string; allowed_repos: string } | undefined
    if (row) {
      const repos = (JSON.parse(row.allowed_repos) as string[]).filter((repo) => !added.includes(repo))
      db.prepare('UPDATE settings SET allowed_repos = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(repos), new Date().toISOString(), row.id)
    }
    db.prepare("DELETE FROM meta WHERE key = 'sample_repos'").run()
  }
  return removed
}

/** Lets Node import the app's TypeScript sources: "@/x" → src/x.ts, extensionless relative imports → .ts. */
function allowAppImports() {
  const src = resolve(APP_ROOT, 'src')
  registerHooks({
    resolve(specifier, context, next) {
      let spec = specifier
      if (spec.startsWith('@/')) spec = pathToFileURL(resolve(src, spec.slice(2))).href
      if ((spec.startsWith('.') || spec.startsWith('file:')) && !/\.[cm]?[jt]sx?$/.test(spec) && context.parentURL) {
        const base = new URL(spec, context.parentURL)
        for (const ext of ['.ts', '/index.ts']) {
          const candidate = new URL(base.href + ext)
          if (existsSync(candidate)) return next(candidate.href, context)
        }
      }
      return next(spec, context)
    },
  })
}

type Row = Record<string, unknown>

function rename(row: Row, table: string): Row {
  const out: Row = {}
  for (const [key, value] of Object.entries(row)) {
    if ((key === 'id' || REF_FIELDS.includes(key)) && typeof value === 'string') out[key] = `${PREFIX}${value}`
    else if (key === 'external_id' && typeof value === 'string') out[key] = `${PREFIX}${value}`
    else if (Array.isArray(value)) out[key] = JSON.stringify(value)
    else if (typeof value === 'boolean') out[key] = value ? 1 : 0
    else out[key] = value ?? null
  }
  if (table === 'tasks') out.dispatched_at = new Date().toISOString() // never sent to a real runner
  return out
}

function insert(db: Db, table: string, row: Row) {
  const keys = Object.keys(row)
  db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).run(...(keys.map((key) => row[key]) as never[]))
}

const config = loadConfig()
const db = openDb(config.dataDir)

if (values.clear) {
  const removed = transaction(db, () => clearSamples(db))
  console.log(`Removed ${removed} sample rows.`)
  db.close()
  process.exit(0)
}

// The sample shops are in Austin; lay their days out on Austin's clock.
process.env.TZ = 'America/Chicago'
allowAppImports()
const seedModule = pathToFileURL(resolve(APP_ROOT, 'src/services/demo/seed/index.ts')).href
const idsModule = pathToFileURL(resolve(APP_ROOT, 'src/services/demo/ids.ts')).href
const { buildSeed } = (await import(seedModule)) as { buildSeed: (options: { now: Date; seed: number; ids: unknown }) => { data: Record<string, unknown> } }
const { createIds } = (await import(idsModule)) as { createIds: () => unknown }
const { data } = buildSeed({ now: new Date(), seed: 20261119, ids: createIds() })

const counts: Record<string, number> = {}
transaction(db, () => {
  clearSamples(db)
  for (const table of ['shops', 'calls', 'appointments', 'tasks', 'task_events', 'approvals', 'alerts', 'handbook_entries', 'decisions']) {
    const rows = data[table] as Row[]
    for (const row of rows) insert(db, table, rename(row, table))
    counts[table] = rows.length
  }
  const store = createStore(db, createBus())
  const settings = store.getSettings()
  const sampleRepos = [...new Set((data.tasks as Row[]).map((task) => String(task.repo)))]
  const added = sampleRepos.filter((repo) => !settings.allowed_repos.includes(repo))
  if (added.length > 0) {
    store.saveSettings({ allowed_repos: [...settings.allowed_repos, ...added] })
    db.prepare("INSERT INTO meta (key, value) VALUES ('sample_repos', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(JSON.stringify(added))
  }
})
db.close()
console.log(
  `Loaded sample data: ${counts.shops} shops, ${counts.calls} calls, ${counts.appointments} appointments, ${counts.tasks} tasks, ` +
    `${counts.approvals} approvals, ${counts.alerts} alerts, ${counts.handbook_entries} handbook entries, ${counts.decisions} decisions. ` +
    'Remove it any time with: npm run seed -- --clear',
)
