# Edge functions

The only code that holds secrets or talks to ElevenLabs, Twilio, Notion or
your Jarvis backend. The full contract is in `docs/backend.md`.

| Function | Caller | What it does |
| --- | --- | --- |
| `elevenlabs-signed-url` | the owner's app | Returns `{ signed_url }` for one voice conversation with `ELEVENLABS_AGENT_ID`. Never cached. |
| `jarvis-command` | the owner's app | `create_task`, `cancel_task`, `decide_approval`: calls the `jarvis_*` database function and your backend in the order the contract fixes. |
| `connection-status` | the owner's app | Always 200 with four entries (`elevenlabs`, `twilio`, `notion`, `jarvis`), checked in parallel with a 6 s deadline each. |
| `jarvis-webhook` | your Jarvis backend | Verifies `X-Jarvis-Signature`, shape-checks the events and applies them with `jarvis_apply_events`. |

The three app functions require the owner's session: a verified bearer token
whose user id equals `settings.owner_id`, read through the caller's own token
so row-level security decides. Only then is the service-role client created.
The webhook takes no session; its HMAC signature (5-minute window, 1 MB cap,
constant-time comparison) is checked before the body is parsed or the
database touched, and with no secret configured it refuses everything (503).

Layout: `<name>/index.ts` wires real dependencies into `Deno.serve`;
`<name>/handler.ts` holds the logic; `_shared/` holds CORS, responses, env,
the owner check, the Supabase clients (`supabase.ts`, the only file that
imports supabase-js) and the Jarvis-backend client. `tests/` is not deployed.

## Secrets

```sh
supabase secrets set ELEVENLABS_API_KEY=… ELEVENLABS_AGENT_ID=…
supabase secrets set JARVIS_API_URL=https://jarvis.example.com JARVIS_API_KEY=…
supabase secrets set JARVIS_WEBHOOK_SECRET=…          # optional, falls back to JARVIS_API_KEY
supabase secrets set TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=…   # optional
supabase secrets set NOTION_API_KEY=…                 # optional
```

`SUPABASE_URL` and the Supabase keys are injected by Supabase.

## Deploy

`supabase/config.toml` sets `verify_jwt = false` for all four (each function
checks its caller itself, and the gateway's own 401 carries no CORS headers).

```sh
supabase functions deploy elevenlabs-signed-url jarvis-command connection-status jarvis-webhook
```

## Test

From `supabase/functions`:

```sh
deno check elevenlabs-signed-url/index.ts jarvis-command/index.ts connection-status/index.ts jarvis-webhook/index.ts
deno test --no-lock tests/
```

No network or secrets are needed: every outbound call and the database are
faked. To try a real deployment, `node scripts/send-webhook.mjs --url
https://<ref>.supabase.co/functions/v1/jarvis-webhook --sample all` sends a
signed sample batch (secret from `--secret` or `JARVIS_WEBHOOK_SECRET`).
