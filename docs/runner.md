# Task runner and pushing data into Jarvis

The Jarvis server (`server/`) stores everything and runs the app, but it
cannot write code itself. A **task runner** does that: any service you run
that can check out a repo, let an AI agent work in it, and push a branch.
This page is the contract between the two, plus the webhook any other
service can use to push calls, appointments and alerts in.

```
 phone ── Jarvis server ──POST /tasks──────────────► your task runner
                │      ◄──POST /hooks/events (signed)── (progress, approvals, results)
                │      ◄──POST /hooks/events (signed)── booking system, scripts…
                └──────◄──POST /hooks/elevenlabs─────── ElevenLabs (finished calls)
```

## Settings on the Jarvis server

| Variable | What it is |
| --- | --- |
| `TASK_RUNNER_URL` | The runner's base address, e.g. `https://runner.example.com` |
| `TASK_RUNNER_KEY` | A long random string. Jarvis sends it to the runner as `Authorization: Bearer …` |
| `JARVIS_WEBHOOK_SECRET` | A long random string. The runner (and anything else) signs what it sends to `/hooks/events` with it |

Without `TASK_RUNNER_URL` and `TASK_RUNNER_KEY`, new tasks stay **queued** and
their log says "No task runner is connected yet. This task will wait in the
queue." Set both and restart: waiting tasks are sent then.

## What Jarvis sends the runner

Every call has `Authorization: Bearer <TASK_RUNNER_KEY>` and
`Content-Type: application/json`, and gives up after 10 seconds. Any 2xx is
success.

| Call | Body | Your answer |
| --- | --- | --- |
| `GET {TASK_RUNNER_URL}/health` | | any 2xx (shown in Settings → Connections) |
| `POST {TASK_RUNNER_URL}/tasks` | `{ "task_id", "title", "repo", "instructions" }` | 2xx, optionally `{ "external_id": "…" }` |
| `POST {TASK_RUNNER_URL}/tasks/{task_id}/cancel` | `{}` | 2xx |
| `POST {TASK_RUNNER_URL}/approvals/{approval_id}/decision` | `{ "decision": "approved" \| "denied", "task_id" }` | 2xx |

- **New task.** Sent right after the owner starts one. A 4xx answer fails the
  task with your reason (send `{ "error": "That repo is archived." }` and the
  owner sees "The task runner turned this task down: That repo is archived.").
  No answer, a timeout or a 5xx keeps the task queued and Jarvis tries again
  every minute. `external_id` is your own id for the task; you can then refer
  to it by that id when you report back.
- **Cancel.** Sent after the owner cancels. The task is already cancelled in
  Jarvis whatever you answer; stop working on it.
- **Approval decision.** Sent only for approvals that belong to a task, and
  *before* Jarvis records the answer: if you don't answer 2xx, nothing is
  recorded and the owner sees "Nothing was changed: …" and can try again.

## What the runner sends back

`POST https://<your Jarvis>/hooks/events`, signed:

```
X-Jarvis-Signature: t=<unix seconds>,v1=<hex hmac_sha256(JARVIS_WEBHOOK_SECRET, "<t>.<raw body>")>
```

```js
import { createHmac } from 'node:crypto'

const body = JSON.stringify({ events: [
  { type: 'task.update', data: { task_id, status: 'running', branch: 'jarvis/fix-footer' } },
  { type: 'task.event',  data: { task_id, kind: 'command', message: 'npm test' } },
] })
const t = Math.floor(Date.now() / 1000)
const v1 = createHmac('sha256', process.env.JARVIS_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')
await fetch('https://jarvis.example.com/hooks/events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Jarvis-Signature': `t=${t},v1=${v1}` },
  body,
})
```

`scripts/send-webhook.mjs --url https://<your Jarvis>/hooks/events` is a
ready-made sender for trying it out.

A typical task, from the runner's side:

1. `task.update` with `status: "running"` (Jarvis stamps `started_at`).
2. `task.event` lines as you go: `kind` is `log` (a note), `command` (a shell
   command you ran), `status` or `error`.
3. When you need a yes: `approval.request` with `kind: "code"`, a `title`
   phrased so "Approve" is a clear answer, and the `task_id`. The task becomes
   `needs_approval` and the owner is alerted. The answer comes to
   `POST /approvals/{id}/decision` above; approving puts the task back to
   `running`, denying cancels it.
4. `task.update` with `status: "done"` plus `result_summary` and `pr_url`
   (or `status: "failed"` plus `error`). Jarvis stamps `finished_at` and
   alerts the owner. A task that is already done, failed or cancelled keeps
   its status; later fields (a late summary) are still stored.

Refer to the task by `task_id` (Jarvis's id) or `task_external_id` (yours).

### The rules of the webhook

- Signed as above. A missing, wrong or tampered signature, or a time more than
  5 minutes away from now, is `401`. The exact same signed request a second
  time is `409` ("already received"), so a retry must be signed again.
  Without `JARVIS_WEBHOOK_SECRET` the endpoint answers `503`.
- Body: `{ "events": [ … ] }` (1 to 100) or a single `{ "type", "data" }`, at
  most 1 MB. A malformed envelope is `400`.
- Events are applied in order, each on its own. The answer lists one result
  per event, and is `200` when all applied, `422` when any failed:

```json
{ "results": [
  { "index": 0, "type": "call.upsert", "ok": true, "id": "…" },
  { "index": 1, "type": "alert.create", "ok": true, "id": "…",
    "notify": { "channel": "text", "phone": "+15125550100", "quiet_hours": false } },
  { "index": 2, "type": "task.update", "ok": false, "error": "No task with that id." }
] }
```

- Unknown fields are rejected so typos surface early. Optional fields may be
  `null` (same as leaving them out).

### Event types

Wherever an event points at another row you can use Jarvis's id or your own:
`shop_id` **or** `shop_phone`; `task_id` **or** `task_external_id`;
`call_id` **or** `call_external_id`. Ids are the strings Jarvis gave out.

| Type | Data | Effect |
| --- | --- | --- |
| `shop.upsert` | `name`, `phone` (E.164), `address?`, `timezone?`, `status?` (`active` \| `paused`) | Creates the shop or updates the one with that `phone` |
| `call.upsert` | `external_id`, shop ref, `caller_phone`, `caller_name?`, `started_at`, `duration_seconds?`, `outcome`, `summary?`, `transcript?` (`[{ role: "agent" \| "caller", text, t }]`) | Creates the call or updates the one with that `external_id` |
| `appointment.upsert` | `external_id`, shop ref, `customer_name`, `customer_phone?`, `service`, `barber?`, `starts_at`, `duration_minutes?`, `status?`, `source?`, `notes?`, call ref? | Creates the appointment or updates the one with that `external_id` |
| `task.update` | task ref, any of `status`, `external_id`, `title`, `branch`, `result_summary`, `pr_url`, `error` | Updates the task (stamps and sticky statuses as above) |
| `task.event` | task ref, `kind`, `message`, `created_at?` | Adds a line to the task's log |
| `approval.request` | `kind` (`code` \| `receptionist` \| `spend` \| `other`), `title`, `detail?`, task ref?, shop ref?, `expires_at?` | Creates a pending approval; a queued or running task it points at becomes `needs_approval`. Past `expires_at` it expires by itself |
| `approval.expire` | `id` | Marks a pending approval `expired` (an answered one can't expire) |
| `alert.create` | `type`, `title`, `body?`, shop ref?, call ref?, task ref?, `approval_id?` | Creates an alert and routes it (below) |

Values: outcomes `booked`, `answered`, `message`, `transferred`, `missed`,
`failed`; task statuses `queued`, `running`, `needs_approval`, `done`,
`failed`, `cancelled`; appointment statuses `booked`, `confirmed`,
`completed`, `cancelled`, `no_show`; sources `jarvis`, `online`, `walk_in`.

### Alerts Jarvis raises by itself

So you don't have to, Jarvis creates these alerts on its own. Don't send an
`alert.create` for them too, or the owner hears about it twice:

| When | Alert |
| --- | --- |
| A call is stored as (or changes to) `missed` / `failed` | `missed_call` / `failed_call` |
| A task reaches `done` / `failed` | `task_done` / `task_failed` |
| An `approval.request` arrives | `approval_needed` |

Use `alert.create` for anything else (`system`, for example).

### Alert routing

Every alert's channel comes from the owner's Settings: the preference for
that alert type (`call`, `text` or `in_app`); during quiet hours, or with no
phone number saved, `call` and `text` become `in_app`. When the channel is
`text` or `call` and `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and
`TWILIO_FROM_NUMBER` are set, Jarvis sends the text or places a call that
reads the alert out. A failed text or call is logged; it never fails the
request.

## ElevenLabs post-call webhook

`POST https://<your Jarvis>/hooks/elevenlabs` takes ElevenLabs' own
post-call webhook, so finished receptionist calls land in Jarvis with their
transcript and summary without a runner in between. Set
`ELEVENLABS_WEBHOOK_SECRET` to the secret ElevenLabs shows for the webhook.

**The field names and the signature format were written from memory, not
checked against ElevenLabs' documentation** (it couldn't be reached while
this was built). Everything assumed is listed at the top of
`server/src/elevenlabs-hook.ts`, the only file to change if ElevenLabs
differs. In short:

- Header `ElevenLabs-Signature: t=<unix seconds>,v0=<hex hmac_sha256(secret, "<t>.<raw body>")>`, accepted within 30 minutes.
- `post_call_transcription` events become calls: `data.conversation_id` is the
  call's `external_id`, `data.transcript[]` (`role` `agent`/`user`,
  `message`, `time_in_call_secs`) the transcript,
  `data.analysis.transcript_summary` the summary,
  `data.metadata.start_time_unix_secs` / `call_duration_secs` the times, and
  `data.metadata.phone_call.agent_number` / `external_number` the called and
  calling numbers. `call_initiation_failure` becomes a missed or failed call.
  Audio events are ignored (turn audio off: bodies over 1 MB are refused).
- The outcome is the agent's Data Collection item named `outcome` when you add
  one (`booked`, `answered`, `message`, `transferred`), otherwise `missed` if
  the caller never spoke and `answered` if they did. A Data Collection item
  named `caller_name` fills in the caller's name.
- The shop is the one whose phone is the number that was called. A number
  Jarvis hasn't seen becomes a new shop named after it (rename it by sending a
  `shop.upsert`). Calls with no number (test calls from the dashboard) go to
  the shop named in `ELEVENLABS_AGENT_SHOPS` (`agent_id=+15125550142`,
  comma-separated), or to the only shop if there is exactly one.
