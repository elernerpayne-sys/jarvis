# Jarvis

Your private command center for Jarvis, the AI operator that answers the
phone for your barbershops and runs coding tasks for you. It is a mobile-first
web app you can install on your phone's home screen.

| Screen | What it is for |
| --- | --- |
| **Home** | Talk to Jarvis (voice, with a live transcript and a typed fallback), today's brief, and anything waiting for your approval |
| **Receptionist** | Each barbershop's calls and bookings, upcoming appointments, and every call's summary and transcript |
| **Code** | Coding tasks: start one (type or dictate), watch its progress log, cancel it |
| **Memory** | The Business Handbook and the Decisions Log, searchable and editable |
| **Settings** | Connection status, how Jarvis reaches you per alert type, quiet hours, allowed repos |

## Run it now (demo mode)

```sh
cd jarvis
npm install
npm run dev
```

Open <http://localhost:5173>. With nothing configured the app runs in
**demo mode**: realistic sample data, no sign-in, and a small simulator so
things move on their own (a running task logs lines and then asks for
approval, calls come in, tasks you start run to completion). Nothing is
saved; a reload resets it.

In demo mode Talk to Jarvis is a stand-in: it gives a scripted briefing from
the sample data and answers simple typed questions. It does not hear you. The
real voice conversation needs live mode (below) and an https address.

To look at a particular state, add `?demo=empty`, `?demo=error` or
`?demo=slow` to the address. `?demo=off` goes back to normal.

Demo mode is on **only** while nothing is configured. As soon as
`VITE_JARVIS_API_URL` is set (or, for the Supabase alternative, both Supabase
values), the app is live and everything sits behind sign-in.

## Open it on your phone

**Quick look, same Wi-Fi.** `npm run dev` prints a "Network" address such as
`http://192.168.1.20:5173`. Open that on your phone. Everything is clickable,
but the microphone and installing it as an app both need https.

**The real thing (https).** Either:

- *Tunnel from your computer.* Build and serve, then point any https tunnel at
  it:

  ```sh
  npm run build && npm run preview          # serves on port 4173
  npx cloudflared tunnel --url http://localhost:4173    # or: ngrok http 4173
  ```

  Open the `https://…` address the tunnel prints.

- *Deploy it.* For the real thing with your data, deploy the Jarvis server
  (see **Go live** below); it serves the app too. To put just the demo
  online, it is a static site: on Vercel, Netlify or Cloudflare Pages set the
  root directory to `jarvis`, the build command to `npm run build` and the
  output directory to `dist` (`vercel.json` and `public/_redirects` handle
  client-side routing).

**Install it.** iPhone: open the address in Safari, tap Share, then *Add to
Home Screen*. Android: Chrome menu, then *Install app* (or use the button
under Settings → On your phone).

## Go live

Jarvis comes with its own backend (`server/`): one small service that holds
your data, signs you in, talks to ElevenLabs and Twilio, and serves the app
itself. You deploy that one service and open its address on your phone.

### 1. Deploy it (Railway or Render)

The repo has a `Dockerfile` that builds the app and runs the server, so both
hosts only need to be pointed at it. Your data lives in one file on a
**volume**, so it survives restarts and redeploys.

**Railway**

1. *New project → Deploy from GitHub repo*, pick this repo.
2. In the service's *Settings*: set **Root directory** to `jarvis` (Railway
   then finds the `Dockerfile` by itself).
3. *Add a volume* to the service, mounted at `/data`.
4. *Variables*: add the ones below.
5. *Settings → Networking → Generate domain*. That `https://…up.railway.app`
   address is your Jarvis.

**Render**

1. *New → Web Service*, connect this repo.
2. **Root directory** `jarvis`, **Runtime** Docker (it finds the `Dockerfile`).
3. Pick an instance type that allows a disk (the free one doesn't), then
   *Advanced → Add disk*, mount path `/data`.
4. *Environment*: add the variables below. Health check path: `/healthz`.
5. Deploy. The `https://…onrender.com` address is your Jarvis.

### 2. Set the variables

| Variable | Needed? | What to put |
| --- | --- | --- |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | **Required** (first start) | Your email and a password of 10+ characters. Your account is created the first time the server starts; nobody else can ever sign up. |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` | For Talk to Jarvis | ElevenLabs → API keys, and your agent's id |
| `ELEVENLABS_WEBHOOK_SECRET` | For calls to show up | The secret ElevenLabs gives you in step 4 |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | To be texted or called about alerts | From the Twilio console; the "from" number is one of your Twilio numbers, like `+15125550100` |
| `RESEND_API_KEY`, `MAIL_FROM` | For "email me a code" sign-in | A [Resend](https://resend.com) key and a sender on your domain, like `Jarvis <jarvis@yourdomain.com>` |
| `TASK_RUNNER_URL`, `TASK_RUNNER_KEY`, `JARVIS_WEBHOOK_SECRET` | For coding tasks | Your task runner ([`docs/runner.md`](docs/runner.md)). Without one, tasks wait in the queue. |
| `NOTION_API_KEY` | Optional | Shows Notion in Settings → Connections |

`DATA_DIR` (`/data`) and `PORT` are already set by the image and the host.
Every name is explained in [`.env.example`](.env.example). Nothing here is
ever sent to your phone.

You can remove `OWNER_PASSWORD` after the first start. To change your
password later, open the host's shell (Railway: `railway ssh`; Render: the
service's *Shell* tab) and run:

```sh
npm run owner -- --email you@example.com
```

It asks for the new password and signs out every device.

### 3. Open it on your phone

Open your Jarvis address in Safari (iPhone) or Chrome (Android), sign in, and
add it to your home screen (Share → *Add to Home Screen*, or Chrome's menu →
*Install app*). It opens full screen like an app from then on.

Empty screens until real calls arrive? Load believable sample data from the
host's shell with `npm run seed`, and remove it again with
`npm run seed -- --clear` (your own data is left alone).

### 4. Connect ElevenLabs

In your ElevenLabs agent's settings:

- **Post-call webhook**: point it at `https://<your Jarvis>/hooks/elevenlabs`,
  with transcripts on and audio off, and copy its secret into
  `ELEVENLABS_WEBHOOK_SECRET`. Every finished call then shows up under
  Receptionist with its transcript and summary, filed under the shop whose
  number was called. Optional: add Data Collection items named `outcome`
  (booked / answered / message / transferred) and `caller_name` so calls are
  labelled exactly. (The webhook's format is written from memory of
  ElevenLabs' docs; see [`docs/runner.md`](docs/runner.md) if calls don't
  appear.)
- **Security**: turn on authentication, so a conversation can only start with
  a signed link from Jarvis. Also allow the **text only** override; the typed
  fallback uses it.
- **Advanced → Client events**: keep `user_transcript`, `agent_response`,
  `agent_response_correction`, `audio` and `interruption` on. The live
  transcript is built from these.

Settings → Connections in the app tells you what is connected and what is
missing.

### Running it on your own computer

```sh
npm install
npm run build:server-app     # builds the app for the server
npm run owner -- --email you@example.com
npm start                    # http://localhost:8080
```

`npm run seed` loads sample data here too. Settings come from your shell or
from `.env.local`.

### Alternatives

- **Your own backend.** The app can talk to any server that answers the
  endpoints in [`docs/app-api.md`](docs/app-api.md). Set
  `VITE_JARVIS_API_URL=https://your-backend.example.com` when building the
  app, and allow the app's address there (CORS).
- **Supabase.** Tables, sign-in and live updates in Supabase, with your
  backend pushing data in through a webhook. Described in
  [`docs/backend.md`](docs/backend.md); the database and functions are in
  `supabase/`. Leave `VITE_JARVIS_API_URL` empty and set `VITE_SUPABASE_URL`
  and `VITE_SUPABASE_PUBLISHABLE_KEY` instead.

## What is real and what is sample data

Everything on screen in demo mode is sample data from `src/services/demo`.
In live mode every screen shows what your Jarvis server stores, and only that
(plus the optional `npm run seed` sample, which you can remove).

| Area | Live mode | What it needs |
| --- | --- | --- |
| Sign-in | Real: email and password, or a 6-digit code by email | `OWNER_EMAIL`/`OWNER_PASSWORD`; Resend for codes |
| Talk to Jarvis | Real ElevenLabs conversation through a signed link | `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` |
| Shops, calls, transcripts | Real, from ElevenLabs' post-call webhook (or anything posting to `/hooks/events`) | `ELEVENLABS_WEBHOOK_SECRET` |
| Appointments | Real when your booking system posts them to `/hooks/events` | `JARVIS_WEBHOOK_SECRET` and a sender |
| Tasks, approvals | Real: started, cancelled and approved in the app; the work is done by your task runner | `TASK_RUNNER_URL`, `TASK_RUNNER_KEY`, `JARVIS_WEBHOOK_SECRET` |
| Alerts and how you are reached | Real, routed by your Settings and quiet hours; texts and calls through Twilio | Twilio variables |
| Handbook, decisions | Real, editable, saved on the server. Notion sync is not built; `notion_page_id` is ready for it | Nothing |
| Connection status | Real checks of ElevenLabs, Twilio, Notion and the server itself | Nothing |
| Live updates | Changes appear within a second | Nothing |

## How it is put together

```
src/
  lib/types.ts            the data model (mirrors the database tables)
  services/types.ts       the one service interface every screen uses
  services/demo/          sample data + simulator (demo mode)
  services/jarvis/        your Jarvis backend: fetch client, sign-in, live updates
  services/live/          Supabase alternative: tables, realtime, edge functions
  services/hooks.ts       data hooks used by the screens
  features/               home, voice, receptionist, code, memory, settings, auth
  components/             shared UI
supabase/                 (Supabase alternative only)
  migrations/             tables, row-level security, database functions
  functions/              elevenlabs-signed-url, jarvis-command, connection-status, jarvis-webhook
  seed.sql                optional sample data
server/                   the Jarvis backend: one Node service, SQLite, no dependencies
  src/                    API, webhooks, sign-in, live updates, alerts, static files
  scripts/                npm run owner, npm run seed
  test/                   npm run test:server
Dockerfile                builds the app and runs the server
docs/app-api.md           the endpoints the app needs from its backend
docs/runner.md            the task runner contract and the incoming webhooks
docs/backend.md           the Supabase alternative's contract
```

To put a different backend behind the app, implement `JarvisService`
(`src/services/types.ts`) and return it from `src/services/index.ts`.

## Checks

```sh
npm run typecheck     # TypeScript
npm test              # unit and component tests
npm run lint
npm run build         # production build, including the service worker
npm run test:server   # the Jarvis server, end to end against a real database
npm run test:db       # database: access rules and functions (needs psql; set DATABASE_URL to an empty Postgres database)
npm run test:functions  # edge functions (needs Deno on your PATH)
```
