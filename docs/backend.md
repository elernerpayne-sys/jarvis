# Jarvis backend contract

This is the contract between the app, Supabase, and your separate Jarvis
backend. The app only ever talks to Supabase. Supabase edge functions are the
only code that talks to ElevenLabs, Twilio, Notion or the Jarvis backend, and
they are the only place secrets live.

```
 phone ── Supabase (tables, realtime, auth) ──┐
   │                                          │
   └── edge functions ──► ElevenLabs          │
            │      └────► Jarvis backend ─────┘  (pushes back through the webhook)
```

## Secrets

Set with `supabase secrets set NAME=value`. Nothing here is ever sent to the
browser.

| Secret | Needed for | Notes |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | Talk to Jarvis, connection status | |
| `ELEVENLABS_AGENT_ID` | Talk to Jarvis, connection status | |
| `JARVIS_API_URL` | Sending tasks and decisions to your backend | Base URL, no trailing slash |
| `JARVIS_API_KEY` | Authenticating to your backend | Sent as `Authorization: Bearer …` |
| `JARVIS_WEBHOOK_SECRET` | Verifying pushes from your backend | Optional. Falls back to `JARVIS_API_KEY` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Twilio status check | Optional. Without them, Twilio status is inferred from the phone numbers attached in ElevenLabs |
| `NOTION_API_KEY` | Notion status check | Optional, for the later sync |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected into edge functions by Supabase.

## Tables

All in `public`. Row-level security is on for every table: only the owner
account can read anything, and the owner can only write where the app needs
it. Edge functions write with the service role.

| Table | Owner can | Written by |
| --- | --- | --- |
| `shops` | read | webhook |
| `appointments` | read | webhook |
| `calls` | read | webhook |
| `tasks` | read | `jarvis-command`, webhook |
| `task_events` | read | `jarvis-command`, webhook |
| `approvals` | read | `jarvis-command`, webhook |
| `alerts` | read, mark read | webhook |
| `handbook_entries` | read, add, edit, delete | app |
| `decisions` | read, add, edit, delete | app |
| `settings` | read, edit preferences | app |

Column names and types are exactly the fields in `src/lib/types.ts`
(`Shop`, `Appointment`, `Call`, `Task`, `TaskEvent`, `Approval`, `Alert`,
`HandbookEntry`, `Decision`, `Settings`).

### The owner

`settings` holds exactly one row. Its `owner_id` is the one account allowed in.
The first account created in Supabase Auth becomes the owner automatically.
Any other account can sign in but sees nothing. To change the owner, run
`supabase/snippets/set_owner.sql`.

### Realtime

`tasks`, `task_events`, `approvals`, `alerts`, `calls` and `appointments` are
in the `supabase_realtime` publication. The app subscribes to all six.

### RPCs

Both run with the caller's permissions, so row-level security applies.

```
get_brief(p_from timestamptz, p_to timestamptz)
  → one row: calls_answered int, bookings_made int, missed_calls int, tasks_finished int

get_shop_summaries(p_from timestamptz, p_to timestamptz)
  → one row per shop: every shops column, plus
    calls_today int, bookings_today int, missed_today int, next_appointment_at timestamptz
```

`p_from`/`p_to` are the start and end of "today" on the owner's device
(`p_from` inclusive, `p_to` exclusive).

- calls answered: calls started in range whose outcome is not `missed` or `failed`
- bookings made: calls started in range whose outcome is `booked`
- missed calls: calls started in range whose outcome is `missed` or `failed`
- tasks finished: tasks with status `done` and `finished_at` in range
- next appointment: the earliest appointment from now on with status `booked` or `confirmed`

### Internal functions (service role only)

Everything that writes on Jarvis's behalf is a Postgres function, so each
change is atomic and can be tested against a real database. Only the service
role may execute them; the app cannot call them. Edge functions verify who is
asking, talk to the outside world, and then call these.

```
jarvis_create_task(p_repo text, p_instructions text) → tasks
  Checks p_repo is in settings.allowed_repos and p_instructions is 1–8000
  characters after trimming. Inserts the task as 'queued' with a title taken
  from the first line of the instructions (cut at a word boundary, 72
  characters, with an ellipsis when cut) and logs a 'status' event "Queued".

jarvis_record_dispatch(p_task_id uuid, p_outcome text, p_external_id text, p_detail text) → tasks
  What happened when the task was handed to the Jarvis backend. p_outcome:
    'accepted'        stores p_external_id (may be null), logs "Sent to Jarvis."
    'not_configured'  task stays queued, logs "Jarvis backend isn't connected
                      yet. This task will wait in the queue."
    'rejected'        task becomes 'failed' with error = p_detail and
                      finished_at = now, logs an 'error' event with p_detail.

jarvis_cancel_task(p_task_id uuid) → tasks
  Only while 'queued', 'running' or 'needs_approval'. Sets 'cancelled' and
  finished_at, marks the task's pending approvals 'expired', logs a 'status'
  event "Cancelled by you".

jarvis_decide_approval(p_approval_id uuid, p_decision text) → approvals
  Only while 'pending'. p_decision is 'approved' or 'denied'. Sets status and
  decided_at. If the approval's task is 'needs_approval': approved → task
  'running' + 'status' event "Approved by you"; denied → task 'cancelled',
  finished_at = now + 'status' event "Denied by you".

jarvis_apply_events(p_events jsonb) → jsonb
  The webhook's work. p_events is the array of { "type", "data" } objects
  (already shape-checked by the edge function). Applies them in order, each
  in its own sub-transaction, and returns the "results" array described under
  "Webhook: Response" — including "notify" for alert.create.
```

Errors are raised with these SQLSTATE codes so callers can tell them apart;
the message is a sentence that is safe to show the owner:

| SQLSTATE | Meaning | Edge function answers |
| --- | --- | --- |
| `JV404` | The task or approval does not exist | 404 `not_found` |
| `JV400` | The input is not acceptable (repo not allowed, empty instructions, bad decision) | 400 `invalid` |
| `JV409` | Too late: the task is already finished, or the approval already decided | 409 `invalid` |

Inside `jarvis_apply_events` a failing event does not raise: its entry in the
results is `{ "ok": false, "error": "<the message>" }`.

## Edge functions the app calls

All three need the owner's session (`Authorization: Bearer <user JWT>`, sent
automatically by `supabase.functions.invoke`). They return JSON. On failure
they return a non-2xx status and:

```json
{ "error": { "code": "not_configured", "message": "A sentence the app can show." } }
```

Codes: `unauthorized` (401), `forbidden` (403, signed in but not the owner),
`invalid` (400), `not_found` (404), `not_configured` (503, a secret is
missing), `upstream` (502, the third party failed).

### `elevenlabs-signed-url`

`POST` with an empty body.

```json
{ "signed_url": "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=…&conversation_signature=…" }
```

### `jarvis-command`

`POST` with one of:

```json
{ "action": "create_task", "repo": "owner/name", "instructions": "…" }
{ "action": "cancel_task", "task_id": "<uuid>" }
{ "action": "decide_approval", "approval_id": "<uuid>", "decision": "approved" }
```

Responses: `{ "task": Task }` for the first two, `{ "approval": Approval }`
for the third.

- **create_task** checks that `repo` is in `settings.allowed_repos` and that
  `instructions` is 1–8000 characters. It inserts the task as `queued` with a
  title taken from the first line of the instructions, logs a `status` event,
  then calls your backend. If `JARVIS_API_URL` is not set the task stays
  `queued` and the log says so. If your backend is set but does not accept the
  task, the task is marked `failed` with the reason.
- **cancel_task** works while the task is `queued`, `running` or
  `needs_approval`. It marks the task `cancelled`, expires its pending
  approvals, logs a `status` event, and tells your backend (best effort).
- **decide_approval** works while the approval is `pending`. If your backend
  is configured it is told first; if that fails nothing is recorded and the
  app shows an error. Then the approval is updated. If the approval belongs to
  a task that is `needs_approval`, approving sets the task back to `running`
  and denying sets it to `cancelled`, each with a `status` event.

### `connection-status`

`POST` with an empty body.

```json
{ "connections": [ ConnectionStatus, ConnectionStatus, ConnectionStatus, ConnectionStatus ] }
```

Always four entries, in the order `elevenlabs`, `twilio`, `notion`, `jarvis`.
A service that is down is reported inside its entry (`state: "error"`); the
function itself still returns 200.

## What your Jarvis backend should implement

Every call carries `Authorization: Bearer <JARVIS_API_KEY>` and
`Content-Type: application/json`. Any 2xx counts as success. Calls time out
after 10 seconds.

| Call | Body | Response |
| --- | --- | --- |
| `GET {JARVIS_API_URL}/health` | | any 2xx |
| `POST {JARVIS_API_URL}/tasks` | `{ "task_id", "title", "repo", "instructions" }` | optional `{ "external_id": "…" }` |
| `POST {JARVIS_API_URL}/tasks/{task_id}/cancel` | `{}` | |
| `POST {JARVIS_API_URL}/approvals/{approval_id}/decision` | `{ "decision": "approved" \| "denied", "task_id": "<uuid or null>" }` | |

## Webhook: your backend pushes into the app

`POST https://<project-ref>.supabase.co/functions/v1/jarvis-webhook`

### Signing

Sign every request with HMAC-SHA256 using the webhook secret
(`JARVIS_WEBHOOK_SECRET`, or `JARVIS_API_KEY` if you did not set one):

```
X-Jarvis-Signature: t=<unix seconds>,v1=<hex hmac_sha256(secret, "<t>.<raw body>")>
```

Requests older or newer than 5 minutes are rejected, as are bodies over 1 MB.
A bad or missing signature returns 401. `scripts/send-webhook.mjs` is a
working sender you can copy from.

```js
import { createHmac } from 'node:crypto'

const body = JSON.stringify({ events: [/* … */] })
const t = Math.floor(Date.now() / 1000)
const v1 = createHmac('sha256', process.env.JARVIS_WEBHOOK_SECRET).update(`${t}.${body}`).digest('hex')

await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Jarvis-Signature': `t=${t},v1=${v1}` },
  body,
})
```

### Body

```json
{ "events": [ { "type": "call.upsert", "data": { } }, { "type": "alert.create", "data": { } } ] }
```

A single `{ "type", "data" }` object is also accepted. Up to 100 events per
request, applied in order. Timestamps are ISO-8601. Unknown fields are
rejected so typos surface early.

Wherever an event points at another row you can use our id or your own:
`shop_id` **or** `shop_phone`; `task_id` **or** `task_external_id`;
`call_id` **or** `call_external_id`.

| Type | Data | Effect |
| --- | --- | --- |
| `shop.upsert` | `name`, `phone`, `address?`, `timezone?`, `status?` (`active` \| `paused`) | Creates the shop or updates the one with that `phone` |
| `call.upsert` | `external_id`, shop ref, `caller_phone`, `caller_name?`, `started_at`, `duration_seconds?`, `outcome`, `summary?`, `transcript?` (array of `{ role: "agent" \| "caller", text, t }`) | Creates the call or updates the one with that `external_id`. Send it again as the call progresses |
| `appointment.upsert` | `external_id`, shop ref, `customer_name`, `customer_phone?`, `service`, `barber?`, `starts_at`, `duration_minutes?`, `status?`, `source?`, `notes?`, call ref? | Creates the appointment or updates the one with that `external_id` |
| `task.update` | task ref, any of `status`, `external_id`, `title`, `branch`, `result_summary`, `pr_url`, `error` | Updates the task. `started_at` is stamped the first time it is `running`, `finished_at` when it reaches `done`, `failed` or `cancelled`. A task that is already `done`, `failed` or `cancelled` keeps its status |
| `task.event` | task ref, `kind` (`status` \| `log` \| `command` \| `error`), `message`, `created_at?` | Appends a line to the task's progress log |
| `approval.request` | `kind` (`code` \| `receptionist` \| `spend` \| `other`), `title`, `detail?`, task ref?, shop ref?, `expires_at?` | Creates a pending approval. If it points at a task that is `queued` or `running`, the task becomes `needs_approval` |
| `approval.expire` | `id` | Marks a pending approval `expired` |
| `alert.create` | `type` (`missed_call` \| `failed_call` \| `approval_needed` \| `task_done` \| `task_failed` \| `system`), `title`, `body?`, shop ref?, call ref?, task ref?, `approval_id?` | Creates an alert and routes it (see below) |

Outcome values: `booked`, `answered`, `message`, `transferred`, `missed`,
`failed`. Task status values: `queued`, `running`, `needs_approval`, `done`,
`failed`, `cancelled`. Appointment status values: `booked`, `confirmed`,
`completed`, `cancelled`, `no_show`. Appointment source values: `jarvis`,
`online`, `walk_in`.

### Response

```json
{
  "results": [
    { "index": 0, "type": "call.upsert", "ok": true, "id": "<uuid>" },
    { "index": 1, "type": "alert.create", "ok": true, "id": "<uuid>",
      "notify": { "channel": "text", "phone": "+15125550100", "quiet_hours": false } }
  ]
}
```

Status is 200 when every event was applied and 422 when at least one failed;
failed entries look like `{ "index": 2, "type": "task.update", "ok": false,
"error": "No task with that id." }`. Events before and after a failed one are
still applied.

### Alert routing

The app does not place calls or send texts. For each `alert.create`, the
webhook looks up the owner's preference for that alert type and returns it as
`notify.channel` (`call`, `text` or `in_app`). During quiet hours, `call` and
`text` become `in_app` and `notify.quiet_hours` is `true`. `notify.phone` is
the owner's number from Settings, or `null`. Your backend should place the
call or send the text only when the channel says so.
