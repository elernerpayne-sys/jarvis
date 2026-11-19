# Jarvis app API

This is everything your Jarvis backend has to answer so the Jarvis app works
against it directly. Build these endpoints, set `VITE_JARVIS_API_URL` to your
backend's address, and the app talks to nothing else.

```
 phone (the app) ──HTTPS──► your Jarvis backend ──► ElevenLabs, Twilio, Notion, your database
                  ◄─ SSE ──  (live updates)
```

Your backend holds every secret (the ElevenLabs key, the owner's password,
everything). The app only ever knows your backend's address and the owner's
session token.

**`server/` in this repo is a complete Jarvis backend that implements every
endpoint here** (one Node service with a SQLite file; see the README's
"Go live" and [`docs/runner.md`](runner.md) for the task runner and the
webhooks that feed it). It also serves the built app from the same address,
in which case build the app with `VITE_JARVIS_API_URL=same-origin`: requests
then go to the site's own `/app/…` and no CORS is involved.

`src/services/jarvis/testing/referenceServer.ts` is a small in-memory version
of this contract used by the app's tests. Read either alongside this page if
anything here is unclear.

## Contents

- [The basics](#the-basics)
- [Minimum to get started](#minimum-to-get-started)
- [Sign-in](#sign-in)
- [Errors](#errors)
- [Endpoints](#endpoints): [Home](#home), [Receptionist](#receptionist),
  [Code](#code), [Memory](#memory), [Settings](#settings),
  [Connections](#connections), [Voice](#voice)
- [Live updates](#live-updates)
- [CORS](#cors)

## The basics

- **Every path starts with `/app/`**, so nothing here collides with routes
  your backend already has. With `VITE_JARVIS_API_URL=https://jarvis.example.com`
  the brief is `GET https://jarvis.example.com/app/brief`; with
  `VITE_JARVIS_API_URL=same-origin` it is `GET /app/brief` on the site the app
  was loaded from.
- **JSON everywhere.** Requests with a body send `Content-Type: application/json`.
  Answer with `Content-Type: application/json`, or with `204 No Content` and
  no body where this page says so.
- **Field names are snake_case, exactly as in `src/lib/types.ts`** (`Task`,
  `Approval`, `Alert`, `Shop`, `Appointment`, `Call`, `HandbookEntry`,
  `Decision`, `Settings`, `ConnectionStatus`). Every field listed there must be
  present; use `null` where a value is missing, never leave a field out.
- **Ids are strings.** Any format (UUIDs are fine).
- **Timestamps are ISO-8601 with a timezone**, e.g. `"2026-11-19T15:04:05.000Z"`.
  Calendar dates (`decided_on`) are `"YYYY-MM-DD"`.
- **Lists are wrapped in an object** (`{ "tasks": [ … ] }`) and single rows
  too (`{ "task": { … } }`). The key for each endpoint is in the tables below.
- **Every request except sign-in carries `Authorization: Bearer <token>`.**
- **Each request has 15 seconds.** After that the app gives up and says
  "Jarvis took too long to answer."

## Minimum to get started

You don't have to build everything at once. Build these first and the app is
usable: you can sign in, see Home, answer approvals and run coding tasks.

1. `POST /app/auth/login` and `GET /app/auth/me` (and `POST /app/auth/logout`)
2. `GET /app/brief`
3. `GET /app/approvals` and `POST /app/approvals/{id}/decision`
4. `GET /app/repos`, `GET /app/tasks`, `GET /app/tasks/{id}`,
   `GET /app/tasks/{id}/events`, `POST /app/tasks`, `POST /app/tasks/{id}/cancel`
5. `GET /app/alerts` (Home shows it; an empty list is fine to start)

**Anything you haven't built yet should answer `501`** (or `404`) with the
error shape below and code `not_configured`:

```json
{ "error": { "code": "not_configured", "message": "Shops aren't connected yet." } }
```

The app shows that sentence where the screen would have been (a plain `404`
from your web framework works too; the app then says "Your Jarvis backend
doesn't support this yet."). Settings → Connections shows four "couldn't
check" rows until `/app/connections` exists, and live updates show "paused"
until `/app/events` exists. Nothing breaks.

## Sign-in

One owner. There is no sign-up, and nothing here may ever create an account.

| Call | Body | Success |
| --- | --- | --- |
| `POST /app/auth/login` | `{ "email", "password" }` | `200 { "token", "user": { "id", "email" } }` |
| `POST /app/auth/code` | `{ "email" }` | `204` |
| `POST /app/auth/verify` | `{ "email", "code" }` | `200 { "token", "user": { "id", "email" } }` |
| `GET /app/auth/me` | | `200 { "user": { "id", "email" } }` |
| `POST /app/auth/logout` | | `204` |

- **login**: wrong email or password → `401` with
  `{ "error": { "code": "unauthorized", "message": "That email and password don’t match." } }`.
  Never say which of the two was wrong.
- **code**: emails a 6-digit code to the owner's address. Answer `204` for
  *any* email, including ones that aren't the owner, so the screen never
  reveals which address is the owner's. Only actually send to the owner. A
  code is good for 10 minutes and for one sign-in. The app strips spaces
  before sending it. If your backend has no way to send email, answer `503`
  `not_configured` with a sentence such as "Email codes aren’t set up on this
  Jarvis yet. Sign in with your password." (the same for every address); the
  sign-in screen shows it.
- **verify**: wrong or expired code → `401` with code `unauthorized` and a
  message such as "That code is wrong or has expired. Ask for a new one."
- **me**: who the token belongs to. The app calls it once when it opens to
  check a saved token still works.
- **logout**: revokes the token in the `Authorization` header. The app has
  already forgotten the token by then, so this is best effort; it may arrive
  without a valid token, so answer `204` regardless.

**Tokens.** Make them long random strings (at least 32 bytes from a secure
random source) or signed tokens, and store only a hash if you keep them in a
database. They should last **30 days**. The app has no refresh step: when a
token expires the owner simply signs in again. Revoke on logout.

**401 means the session ended.** On any endpoint other than login and verify,
answer `401` only when the token is missing, expired or revoked. The app then
forgets the token and goes back to the sign-in screen. Use `403` (`forbidden`)
for "signed in, but not allowed".

**Rate limiting is required.** Someone will find your backend's address.
Suggested limits: login, 5 failed attempts per 15 minutes per email and per IP
address; code, 3 emails per hour per address; verify, 5 wrong codes per code
(then the code is dead). Answer `429` with code `invalid` and a sentence like
"Too many tries. Wait a minute, then try again."

## Errors

Any failure is a non-2xx status with this body:

```json
{ "error": { "code": "invalid", "message": "Pick one of your allowed repos." } }
```

`message` is one plain sentence the owner will see as-is, so write it for
them: no stack traces, no SQL, no "Error:" prefix. Don't restate the action
("Couldn't load tasks"); the screen already says that.

| `code` | Status | When |
| --- | --- | --- |
| `unauthorized` | 401 | No token, or it expired or was revoked (and wrong password / code on sign-in) |
| `forbidden` | 403 | Signed in but not allowed |
| `invalid` | 400, 409, 422, 429 | Bad input (400), too late (409: task already finished, approval already decided), too many tries (429) |
| `not_found` | 404 | The row in the path doesn't exist |
| `not_configured` | 501 or 503 | 501: the endpoint isn't built yet. 503: it's built but a secret is missing (e.g. no ElevenLabs key) |
| `upstream` | 502 | A third party (ElevenLabs, Twilio, Notion) failed |
| `internal` | 500 | Something broke inside your backend |

A `404` means "that row doesn't exist" **only** when its code is `not_found`.
Any other `404` is read as "this endpoint isn't built yet".

## Endpoints

Every endpoint below needs the bearer token.

### Home

| Call | Query / body | Success |
| --- | --- | --- |
| `GET /app/brief` | `?from=<ISO>&to=<ISO>` | `200 { "calls_answered", "bookings_made", "missed_calls", "tasks_finished" }` (integers) |
| `GET /app/approvals` | `?status=pending` (optional: `pending`, `approved`, `denied`, `expired`) | `200 { "approvals": Approval[] }` |
| `POST /app/approvals/{id}/decision` | `{ "decision": "approved" \| "denied" }` | `200 { "approval": Approval }` |
| `GET /app/alerts` | `?limit=50` (optional, 1–200, default 50) | `200 { "alerts": Alert[] }` |
| `POST /app/alerts/{id}/read` | | `204` |
| `POST /app/alerts/read-all` | | `204` |

**Brief.** `from` (inclusive) and `to` (exclusive) are the start and end of
"today" on the owner's phone, so you never have to guess their timezone. Count:

- `calls_answered`: calls with `started_at` in range whose outcome is not `missed` or `failed`
- `bookings_made`: calls with `started_at` in range whose outcome is `booked`
- `missed_calls`: calls with `started_at` in range whose outcome is `missed` or `failed`
- `tasks_finished`: tasks with status `done` and `finished_at` in range

**Approvals** are newest first by `requested_at`, at most 200. Deciding works
only while the approval is `pending`; otherwise answer `409` (`invalid`) with
"This was already decided." or "This request has expired.". Unknown id → `404`
"Couldn’t find that request. It may have been withdrawn." A decision that
isn't `approved` or `denied` → `400`. On success set `status` and
`decided_at = now`. If the approval belongs to a task whose status is
`needs_approval`:

- approved → the task goes back to `running`, plus a `status` task event "Approved by you"
- denied → the task becomes `cancelled` with `finished_at = now`, plus a `status` task event "Denied by you"

If something else has to hear the answer first (the task runner that asked,
see [`docs/runner.md`](runner.md)) and it can't be reached, record nothing
and answer `502` `upstream` with a sentence saying so; the owner can try again.

**Alerts** are newest first by `created_at`. Marking one read sets `read_at =
now` only if it is still `null` (the first time it was read is kept); unknown
id → `404`. `read-all` does the same for every unread alert.

When your backend creates an alert it decides `channel` itself: look up the
owner's `notification_prefs[type]` in Settings; during quiet hours (if
`quiet_hours_enabled`, between `quiet_hours_start` and `quiet_hours_end` in
`timezone`, which may wrap past midnight) `call` and `text` become `in_app`.
Store the result in the alert's `channel`, and place the call or send the text
to `notify_phone` only when the channel says so.

### Receptionist

| Call | Query | Success |
| --- | --- | --- |
| `GET /app/shops` | `?from=<ISO>&to=<ISO>` | `200 { "shops": ShopSummary[] }` |
| `GET /app/shops/{id}` | `?from=<ISO>&to=<ISO>` | `200 { "shop": ShopSummary }` |
| `GET /app/shops/{id}/appointments` | | `200 { "appointments": Appointment[] }` |
| `GET /app/shops/{id}/calls` | `?filter=all` or `?filter=problems` | `200 { "calls": CallSummary[] }` |
| `GET /app/calls/{id}` | | `200 { "call": Call }` |

- **Shops** are sorted by name. A `ShopSummary` is every `Shop` field plus
  today's counters, with `from`/`to` meaning the same as for the brief:
  `calls_today` (all calls started in range), `bookings_today` (outcome
  `booked`), `missed_today` (outcome `missed` or `failed`), and
  `next_appointment_at` (the earliest appointment from now on with status
  `booked` or `confirmed`, or `null`). Unknown shop → `404` "Couldn’t find that shop."
- **Appointments**: from now on (`starts_at >= now`), soonest first, leaving
  out `cancelled`, at most 200.
- **Calls**: newest first by `started_at`, at most 200. `problems` keeps only
  outcomes `missed` and `failed`. **No `transcript` field in lists.**
- **One call** includes `transcript` (an array of `{ "role": "agent" | "caller", "text", "t" }`,
  `t` in seconds from the start; `[]` if there is none yet). Unknown id →
  `404` "Couldn’t find that call."

### Code

| Call | Body | Success |
| --- | --- | --- |
| `GET /app/repos` | | `200 { "repos": ["owner/name", …] }` (the same list as `settings.allowed_repos`) |
| `GET /app/tasks` | | `200 { "tasks": Task[] }` |
| `GET /app/tasks/{id}` | | `200 { "task": Task }` |
| `GET /app/tasks/{id}/events` | | `200 { "events": TaskEvent[] }` |
| `POST /app/tasks` | `{ "repo", "instructions" }` | `201 { "task": Task }` |
| `POST /app/tasks/{id}/cancel` | | `200 { "task": Task }` |

- **Tasks** are newest first by `created_at` (at most 200). **Events** are
  oldest first by `created_at` so they read like a log. Unknown task → `404`
  "Couldn’t find that task."
- **Create**: `repo` must be one of `settings.allowed_repos`, otherwise `400`
  "Jarvis can’t work in {repo}. Pick one of your allowed repos, or add it in
  Settings." (empty repo: "Pick a repo for Jarvis to work in."). `instructions`
  must be 1–8000 characters after trimming, otherwise `400` ("Write what you
  want Jarvis to do." / "Keep the instructions under 8,000 characters.").
  Save it as `queued`, with `title` taken from the first line of the
  instructions (cut at a word boundary to at most 72 characters, with "…"
  when cut), and add a `status` event "Queued". Then start the work however
  your backend does.
- **Cancel** works only while the task is `queued`, `running` or
  `needs_approval`; otherwise `409` "This task has already finished." Set
  `cancelled` and `finished_at = now`, mark the task's pending approvals
  `expired`, and add a `status` event "Cancelled by you".
- As the work runs, keep the task current: `started_at` the first time it is
  `running`; `finished_at` when it reaches `done`, `failed` or `cancelled`;
  `updated_at` on every change. Ask for approval by creating a `pending`
  approval with `task_id` set and moving the task to `needs_approval`.

### Memory

| Call | Body | Success |
| --- | --- | --- |
| `GET /app/handbook` | | `200 { "entries": HandbookEntry[] }` |
| `POST /app/handbook` | `{ "title", "category", "content", "tags" }` | `201 { "entry": HandbookEntry }` |
| `PUT /app/handbook/{id}` | `{ "title", "category", "content", "tags" }` | `200 { "entry": HandbookEntry }` |
| `DELETE /app/handbook/{id}` | | `204` |
| `GET /app/decisions` | | `200 { "decisions": Decision[] }` |
| `POST /app/decisions` | `{ "title", "decision", "rationale", "decided_on", "tags" }` | `201 { "decision": Decision }` |
| `PUT /app/decisions/{id}` | `{ "title", "decision", "rationale", "decided_on", "tags" }` | `200 { "decision": Decision }` |
| `DELETE /app/decisions/{id}` | | `204` |

- Handbook entries are most recently updated first; decisions by `decided_on`
  newest first, then `created_at` newest first. At most 500 of each (search
  happens on the phone, so send them all).
- The app trims everything and removes blank and repeated tags before
  sending; check again anyway. Handbook: `title` required ("Give the entry a
  title."). Decisions: `title` and `decision` required, `rationale` is a
  string or `null`, `decided_on` is `"YYYY-MM-DD"` ("Pick the date this was
  decided."). Bad input → `400`.
- **Never accept `notion_page_id` from the app.** Ignore it if it is ever
  sent; only your Notion sync sets it. New rows start with `null`.
- Set `created_at` and `updated_at` on create, `updated_at` on every edit.
  Unknown id on `PUT` or `DELETE` → `404` ("Couldn’t find that entry. It may
  have been deleted." / "Couldn’t find that decision. It may have been deleted.").

### Settings

| Call | Body | Success |
| --- | --- | --- |
| `GET /app/settings` | | `200 { "settings": Settings }` |
| `PATCH /app/settings` | any of the fields below | `200 { "settings": Settings }` |

There is exactly one settings record. `PATCH` changes only the fields it
contains, and only these:

| Field | Rule |
| --- | --- |
| `notify_phone` | E.164 (`+15125550142`) or `null` |
| `notification_prefs` | Object of alert type → `call` \| `text` \| `in_app`; merge it into the current prefs (the app may send only some types) |
| `quiet_hours_enabled` | `true` / `false` |
| `quiet_hours_start`, `quiet_hours_end` | `"HH:MM"`, 24-hour; end may be earlier than start (overnight) |
| `timezone` | An IANA name such as `America/Chicago` |
| `allowed_repos` | Array of `"owner/name"`, trimmed, no blanks or repeats |

Ignore every other field (above all `owner_id`, `id` and `updated_at`); never
let the app change them. Bad values → `400` with a sentence saying which.
Set `updated_at = now` on every change.

### Connections

| Call | Success |
| --- | --- |
| `GET /app/connections` | `200 { "connections": [ ConnectionStatus × 4 ] }` |

Always exactly four entries, in this order: `elevenlabs`, `twilio`, `notion`,
`jarvis`. Each is
`{ "service", "state": "connected" | "not_configured" | "error", "detail", "latency_ms", "checked_at" }`,
where `detail` is one plain sentence ("Agent reachable.", "Add a Twilio key
to check this."). A service that is down is reported inside its entry; the
endpoint itself still answers `200`. `jarvis` is your backend itself (its
own health: database, task runner). Keep the whole check under 10 seconds.

### Voice

| Call | Success |
| --- | --- |
| `POST /app/voice/session` | `200 { "signed_url": "wss://…" }` |

Talk to Jarvis needs a fresh signed link for each conversation. Your backend
keeps the ElevenLabs API key and agent id and asks ElevenLabs for one:

```sh
curl "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=$ELEVENLABS_AGENT_ID" \
  -H "xi-api-key: $ELEVENLABS_API_KEY"
# → { "signed_url": "wss://api.elevenlabs.io/v1/convai/conversation?agent_id=…&conversation_signature=…" }
```

Pass `signed_url` straight back. Key or agent id not set → `503`
`not_configured` ("Voice isn’t set up yet. Add your ElevenLabs key to the
Jarvis backend."). ElevenLabs failed → `502` `upstream`.

In the ElevenLabs agent's settings, turn on authentication (so only signed
links work) and allow the **text only** override (the typed fallback uses it).

## Live updates

`GET /app/events` is a [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html)
stream. It carries the bearer token like every other request (the app reads
it with `fetch`, not `EventSource`, because `EventSource` can't send headers).

Request: `GET /app/events?tables=tasks,task_events,approvals,alerts,calls,appointments`
with `Accept: text/event-stream`. `tables` is the set the app wants; you may
ignore it and send everything (the app drops what it didn't ask for).

Answer `200` with these headers, then keep the connection open:

```
Content-Type: text/event-stream
Cache-Control: no-cache
X-Accel-Buffering: no
```

Send one event per change to a row, as a single `data:` line followed by a
blank line:

```
data: {"table":"tasks","type":"UPDATE","id":"8f3c…","row":{ …the whole Task… }}

data: {"table":"task_events","type":"INSERT","id":"41aa…","row":{ …TaskEvent… }}

data: {"table":"approvals","type":"DELETE","id":"77b1…","row":null}

```

- `table`: one of `tasks`, `task_events`, `approvals`, `alerts`, `calls`, `appointments`
- `type`: `INSERT`, `UPDATE` or `DELETE`
- `id`: the row's id (always, including on `DELETE`)
- `row`: the whole row after the change, shaped exactly like the endpoints
  above return it; `null` on `DELETE`. **For `calls`, leave out `transcript`.**

Send a comment line as a **heartbeat every 25 seconds**, so proxies keep the
connection open and the app knows it is alive:

```
: ping

```

What the app does: it shows "live" once the stream opens. If the stream ends,
errors, or sends nothing at all for 60 seconds, it reconnects after 1s, 2s,
5s, then every 10s, and shows "Live updates are paused" meanwhile. It also
reconnects at once when the phone comes back online. After reconnecting it
reloads every screen, so you never have to replay missed events. A `401`
signs the owner out and stops reconnecting.

Hosting notes: turn off response buffering and compression for this route
(nginx: `X-Accel-Buffering: no` above; some hosts need a setting), and make
sure the platform allows long-lived responses (serverless functions with a
30-second limit don't; the app copes by reconnecting, but a long-running
server is better).

## CORS

Not needed when the backend serves the app itself (`same-origin`, as
`server/` does). Only when the app runs on its own address (for example
`https://jarvis-app.vercel.app`) does the browser ask your backend for
permission first. Then, for every `/app/` route (`server/` does this for the
addresses listed in `ALLOWED_ORIGINS`):

- Answer `OPTIONS` preflight requests with `204` and no authentication check.
- Send these headers on every answer (including errors and the event stream):

```
Access-Control-Allow-Origin: https://jarvis-app.vercel.app
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 86400
Vary: Origin
```

Allow only your app's own address (plus `http://localhost:5173` while you
develop), not `*`. The app sends no cookies, so
`Access-Control-Allow-Credentials` is not needed.
