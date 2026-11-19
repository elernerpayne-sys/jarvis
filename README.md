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

- *Deploy it.* It is a static site. On Vercel, Netlify or Cloudflare Pages set
  the root directory to `jarvis`, the build command to `npm run build` and the
  output directory to `dist`. The redirects for client-side routing are
  already included (`vercel.json`, `public/_redirects`).

**Install it.** iPhone: open the address in Safari, tap Share, then *Add to
Home Screen*. Android: Chrome menu, then *Install app* (or use the button
under Settings → On your phone).

## Go live

The app talks straight to **your Jarvis backend**, the server you already
run. Your backend keeps every key (ElevenLabs and the rest); the app only
knows its address. Three steps:

### 1. Add the app's endpoints to your Jarvis backend

[`docs/app-api.md`](docs/app-api.md) lists every endpoint the app needs, with
exact request and response shapes. Hand it to whoever works on your backend
(or to Claude). All of them live under `/app/` so they can't clash with
anything your backend already does.

You don't need all of them on day one. The page has a short
**"Minimum to get started"** list: sign-in, the brief, approvals and tasks.
Anything not built yet just shows a plain "not supported yet" message in the
app.

While you're there, on your backend:

- **Set the owner's email and password.** There is no sign-up screen; only
  that one account can sign in.
- **Add your ElevenLabs API key and agent id.** Talk to Jarvis asks your
  backend for a signed link, and your backend asks ElevenLabs.
- **Allow the app's address (CORS)**, and limit how often someone can try a
  password or a code. Both are explained in the doc.

### 2. Point the app at your backend

Copy `.env.example` to `.env.local` and fill in one line:

```sh
VITE_JARVIS_API_URL=https://your-jarvis-backend.example.com
```

Restart `npm run dev`. The app now opens on the sign-in screen.

### 3. Deploy the app

Set the same `VITE_JARVIS_API_URL` on your host (Vercel, Netlify or
Cloudflare Pages, see *Open it on your phone* above) and redeploy. Open the
https address on your phone and add it to your home screen.

For the voice conversation, in your ElevenLabs agent's settings:

- **Security**: turn on authentication, so a conversation can only start with
  a signed link from your backend. Also allow the **text only** override; the
  typed fallback uses it.
- **Advanced → Client events**: keep `user_transcript`, `agent_response`,
  `agent_response_correction`, `audio` and `interruption` on. The live
  transcript is built from these.

Talk to Jarvis needs https and microphone permission.

### Alternative: Supabase

The app can also run on a Supabase project instead (tables, sign-in and live
updates in Supabase, with your backend pushing data in through a webhook).
That setup is described in [`docs/backend.md`](docs/backend.md); the
database and functions are in `supabase/`. To use it, leave
`VITE_JARVIS_API_URL` empty and set `VITE_SUPABASE_URL` and
`VITE_SUPABASE_PUBLISHABLE_KEY` instead. If both are set, the Jarvis backend
wins.

## What is real and what is sample data

Everything on screen in demo mode is sample data from `src/services/demo`.
In live mode nothing is sample data: every screen asks your Jarvis backend,
and shows only what it sends back.

| Area | Live mode | Waiting on you |
| --- | --- | --- |
| Sign-in | Real: email and password, or a 6-digit code by email, checked by your backend | Sign-in endpoints and the owner's account on your backend |
| Talk to Jarvis | Real ElevenLabs conversation through a signed link | ElevenLabs key and agent id on your backend, `/app/voice/session` |
| Brief, shops, calls, appointments | Real, from your backend | The Home and Receptionist endpoints |
| Tasks, approvals | Real: started, cancelled and approved through your backend | The Code and approval endpoints, and your task runner |
| Alerts and how you are reached | Shown in the app; your backend places the call or text | Alert endpoints; your backend routing by your preferences |
| Handbook, decisions | Real, editable, saved by your backend | The Memory endpoints. Notion sync is not built; `notion_page_id` is ready for it |
| Connection status | Whatever your backend reports for each service | `/app/connections` |
| Live updates | Changes appear within a second | `/app/events` (until then, screens refresh when you open them) |

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
docs/app-api.md           the endpoints your Jarvis backend answers for the app
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
npm run test:db       # database: access rules and functions (needs psql; set DATABASE_URL to an empty Postgres database)
npm run test:functions  # edge functions (needs Deno on your PATH)
```
