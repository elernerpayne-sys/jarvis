#!/usr/bin/env node
// A working, signed sender for the jarvis-webhook edge function (Node 22, no dependencies).
//
//   node scripts/send-webhook.mjs --url https://<ref>.supabase.co/functions/v1/jarvis-webhook \
//     [--secret <secret>] [--sample shop|call|task|approval|alert|all] [--file events.json]
//
// The secret defaults to $JARVIS_WEBHOOK_SECRET (then $JARVIS_API_KEY). --file sends a JSON
// file as-is ({ "events": [...] } or a single { "type", "data" }). Without --file a sample is
// sent (default "all": a shop, a booked call with its appointment, a task update with log
// lines, an approval request and an alert). The samples use made-up 555-01xx numbers.
// The "task" and "approval" samples point at a task by task_external_id "demo-task-1"; that
// task only exists once a task created in the app was accepted with that external id, so
// expect those entries to come back "No task with that external id." on a fresh project.
//
// Signing (see docs/backend.md):
//   X-Jarvis-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, "<t>.<raw body>")>

import { createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'

const { values: args } = parseArgs({
  options: {
    url: { type: 'string' },
    secret: { type: 'string' },
    sample: { type: 'string', default: 'all' },
    file: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})

const USAGE =
  'Usage: node scripts/send-webhook.mjs --url <webhook url> [--secret <secret>] ' +
  '[--sample shop|call|task|approval|alert|all] [--file events.json]'

if (args.help) {
  console.log(USAGE)
  process.exit(0)
}
const secret = args.secret ?? process.env.JARVIS_WEBHOOK_SECRET ?? process.env.JARVIS_API_KEY
if (!args.url || !secret) {
  console.error(USAGE)
  console.error(!args.url ? 'Missing --url.' : 'Missing --secret (or JARVIS_WEBHOOK_SECRET).')
  process.exit(2)
}

// ── Samples: one coherent little story ─────────────────────────────────────

const SHOP_PHONE = '+15125550100'
const now = new Date()
const iso = (offsetMinutes) => new Date(now.getTime() + offsetMinutes * 60_000).toISOString()
const callId = `demo-call-${now.getTime()}`

const shop = {
  type: 'shop.upsert',
  data: { name: 'Demo Barbers (Main St)', phone: SHOP_PHONE, address: '100 Example Ave', timezone: 'America/Chicago', status: 'active' },
}
const call = [
  {
    type: 'call.upsert',
    data: {
      external_id: callId,
      shop_phone: SHOP_PHONE,
      caller_phone: '+15125550123',
      caller_name: 'Test Caller',
      started_at: iso(-5),
      duration_seconds: 94,
      outcome: 'booked',
      summary: 'Booked a skin fade for tomorrow at 10:00.',
      transcript: [
        { role: 'agent', text: 'Thanks for calling Demo Barbers, how can I help?', t: 0 },
        { role: 'caller', text: 'Can I get a fade tomorrow morning?', t: 3.2 },
        { role: 'agent', text: 'You are booked for 10:00 tomorrow.', t: 41.5 },
      ],
    },
  },
  {
    type: 'appointment.upsert',
    data: {
      external_id: `demo-appt-${now.getTime()}`,
      shop_phone: SHOP_PHONE,
      call_external_id: callId,
      customer_name: 'Test Caller',
      customer_phone: '+15125550123',
      service: 'Skin fade',
      barber: 'Alex',
      starts_at: iso(24 * 60),
      duration_minutes: 30,
      status: 'booked',
      source: 'jarvis',
    },
  },
]
const task = [
  { type: 'task.update', data: { task_external_id: 'demo-task-1', status: 'running', branch: 'jarvis/demo-fix' } },
  { type: 'task.event', data: { task_external_id: 'demo-task-1', kind: 'command', message: 'npm test' } },
  { type: 'task.event', data: { task_external_id: 'demo-task-1', kind: 'log', message: '42 tests passed.' } },
]
const approval = {
  type: 'approval.request',
  data: { kind: 'code', title: 'Open a pull request for jarvis/demo-fix?', detail: 'All tests pass.', task_external_id: 'demo-task-1', expires_at: iso(60) },
}
const alert = {
  type: 'alert.create',
  data: { type: 'system', title: 'Demo webhook delivered', body: 'This alert came from scripts/send-webhook.mjs.', shop_phone: SHOP_PHONE },
}

const SAMPLES = {
  shop: [shop],
  call: [shop, ...call],
  task,
  approval: [approval],
  alert: [shop, alert],
  all: [shop, ...call, ...task, approval, alert],
}

let body
if (args.file) {
  body = await readFile(args.file, 'utf8')
  try {
    JSON.parse(body)
  } catch {
    console.error(`${args.file} is not valid JSON.`)
    process.exit(2)
  }
} else {
  const events = SAMPLES[args.sample]
  if (!events) {
    console.error(`Unknown sample "${args.sample}". Use one of: ${Object.keys(SAMPLES).join(', ')}.`)
    process.exit(2)
  }
  body = JSON.stringify({ events })
}

// ── Sign and send ───────────────────────────────────────────────────────────

const t = Math.floor(Date.now() / 1000)
const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')

let response
try {
  response = await fetch(args.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Jarvis-Signature': `t=${t},v1=${v1}` },
    body,
    signal: AbortSignal.timeout(30_000),
  })
} catch (error) {
  console.error(`Could not reach ${args.url}: ${error.message}`)
  process.exit(1)
}

const text = await response.text()
console.log(`HTTP ${response.status}`)
try {
  const parsed = JSON.parse(text)
  if (Array.isArray(parsed.results)) {
    for (const r of parsed.results) {
      const mark = r.ok ? 'ok ' : 'ERR'
      const extra = r.ok ? (r.id ?? '') + (r.notify ? ` notify=${JSON.stringify(r.notify)}` : '') : r.error
      console.log(`${mark} #${r.index} ${r.type ?? '?'} ${extra}`)
    }
  } else {
    console.log(JSON.stringify(parsed, null, 2))
  }
} catch {
  console.log(text)
}
process.exit(response.ok ? 0 : 1)
