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

Open <http://localhost:5173>. With no Supabase keys set the app runs in
**demo mode**: realistic sample data, no sign-in, and a small simulator so
things move on their own (a running task logs lines and then asks for
approval, calls come in, tasks you start run to completion). Nothing is
saved; a reload resets it.

In demo mode Talk to Jarvis is a stand-in: it gives a scripted briefing from
the sample data and answers simple typed questions. It does not hear you. The
real voice conversation needs live mode (below) and an https address.

To look at a particular state, add `?demo=empty`, `?demo=error` or
`?demo=slow` to the address. `?demo=off` goes back to normal.

Demo mode is on **only** while `VITE_SUPABASE_URL` or the key is missing. As
soon as both are set, the app is live and everything sits behind sign-in.

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

You need a Supabase project, your ElevenLabs agent, and (for coding tasks)
your Jarvis backend. Do the steps in this order.

### 1. Create the Supabase project and lock sign-up

1. Create a project at <https://supabase.com>.
2. **Authentication → Sign In / Providers**: turn **off** "Allow new users to
   sign up". Keep the Email provider on.
3. **Authentication → Users → Add user**: create your account (your email and
   a strong password, "Auto confirm" on). **The first account ever created
   becomes the owner.** Any other account can sign in but sees nothing.

### 2. Create the tables

Install the [Supabase CLI](https://supabase.com/docs/guides/cli), then from
the `jarvis` folder:

```sh
supabase login
supabase link                 # pick your project
supabase db push --linked     # creates tables, row-level security, functions
```

If you created your account *after* this step, that is fine too: the first
account still becomes the owner. To check or change the owner, run
`supabase/snippets/set_owner.sql` in the SQL editor.

Optional: to see the live app populated before your backend is connected,
paste `supabase/seed.sql` into the SQL editor. It is sample data.

### 3. Add the secrets and deploy the functions

```sh
supabase secrets set \
  ELEVENLABS_API_KEY=… \
  ELEVENLABS_AGENT_ID=… \
  JARVIS_API_URL=https://your-backend.example.com \
  JARVIS_API_KEY=… \
  JARVIS_WEBHOOK_SECRET=…        # optional; falls back to JARVIS_API_KEY

supabase functions deploy
```

Secrets live only in Supabase. None of them is ever sent to the browser.
Each one can be added later; until then the matching feature says it is not
connected (Settings → Connections shows which).

### 4. Point the app at the project

Copy `.env.example` to `.env.local` and fill in the two public values from
**Project Settings → API**:

```sh
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_…
```

Restart `npm run dev` (or set the same two variables on your host and
redeploy). The app now opens on the sign-in screen.

To sign in with an emailed 6-digit code instead of a password, change the
**Magic Link** email template (Authentication → Emails) so it contains
`{{ .Token }}`; `supabase/templates/magic_link.html` has the wording.

### 5. Set up the ElevenLabs agent

In the agent's settings:

- **Security**: turn on authentication, so a conversation can only start with
  a signed link from your project. Also allow the **text only** override; the
  typed fallback uses it.
- **Advanced → Client events**: keep `user_transcript`, `agent_response`,
  `agent_response_correction`, `audio` and `interruption` on. The live
  transcript is built from these.

Talk to Jarvis needs https and microphone permission.

### 6. Connect your Jarvis backend

`docs/backend.md` is the full contract. In short:

- The app sends work to your backend: `POST /tasks`,
  `POST /tasks/{id}/cancel`, `POST /approvals/{id}/decision`, and
  `GET /health`, each with `Authorization: Bearer <JARVIS_API_KEY>`.
- Your backend pushes calls, appointments, task progress, approval requests
  and alerts into the app through one signed webhook:
  `https://<project-ref>.supabase.co/functions/v1/jarvis-webhook`.

Try the webhook before writing any backend code:

```sh
node scripts/send-webhook.mjs \
  --url https://<project-ref>.supabase.co/functions/v1/jarvis-webhook \
  --secret "$JARVIS_WEBHOOK_SECRET" --sample all
```

The sample rows appear in the app within a second. The script is also the
reference for how to sign a request.

Calls and texts are placed by your backend, not by this app. When your
backend pushes an alert, the webhook answers with how you asked to be reached
for that kind of alert (call, text or in-app only, with quiet hours applied).

## What is real and what is sample data

Everything on screen in demo mode is sample data from `src/services/demo`.
In live mode nothing is sample data: every screen reads your Supabase tables,
and they are empty until your backend (or `supabase/seed.sql`) fills them.

| Area | Live mode | Waiting on you |
| --- | --- | --- |
| Sign-in, row-level security | Real | Create your account |
| Talk to Jarvis | Real ElevenLabs conversation through a signed link | ElevenLabs key and agent id |
| Brief, shops, calls, appointments | Real tables, live updates | Your backend pushing through the webhook |
| Tasks, approvals | Real tables; sent to your backend | `JARVIS_API_URL`, `JARVIS_API_KEY`, backend endpoints |
| Alerts and how you are reached | Stored and routed by your preferences | Your backend placing the call or text |
| Handbook, decisions | Real, editable | Notion sync is not built; `notion_page_id` is ready for it |
| Connection status | Real checks from an edge function | Twilio and Notion keys are optional |

## How it is put together

```
src/
  lib/types.ts            the data model (mirrors the database tables)
  services/types.ts       the one service interface every screen uses
  services/demo/          sample data + simulator (demo mode)
  services/live/          Supabase: tables, realtime, edge functions
  services/hooks.ts       data hooks used by the screens
  features/               home, voice, receptionist, code, memory, settings, auth
  components/             shared UI
supabase/
  migrations/             tables, row-level security, database functions
  functions/              elevenlabs-signed-url, jarvis-command, connection-status, jarvis-webhook
  seed.sql                optional sample data
docs/backend.md           the contract for your Jarvis backend
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
