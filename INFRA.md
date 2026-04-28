# Infra Setup Checklist

End-to-end, ~30 min. PoC only — prod = dev = test.

## 1. Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. `/newbot` → pick a name and username (e.g. `hebtut_bot`). Save the **token**.
3. Get your own numeric Telegram user id from [@userinfobot](https://t.me/userinfobot). Save it as `BOOTSTRAP_ADMIN_TG_USER_IDS`. **You can list multiple ids comma-separated** (e.g. `12345,67890`) — every listed id is auto-promoted to `admin` on first webhook hit.
4. (Skip the Mini-App URL for now — we'll set it after the Vercel deploy.)

## 2. Supabase project

> **Heads up — Supabase dashboard changed in late 2025.** The API page split into separate **API Keys** and **JWT Keys** sections, and projects created after November 2025 use the new `sb_publishable_...` / `sb_secret_...` key formats instead of legacy `anon` / `service_role`. The new keys are drop-in replacements for our app — only the value strings changed, not how `@supabase/supabase-js` consumes them.

1. Create a new project at [supabase.com](https://supabase.com) (e.g. `hebtutbot-dev`). Wait ~2 min for it to provision.

2. **Project URL & API keys.** Open **Project Settings → API Keys** (or click the **Connect** button at the top of the project page). Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **Publishable key** (`sb_publishable_...`, or `anon` on legacy projects) → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **Secret key** (`sb_secret_...`, or `service_role` on legacy projects) → `SUPABASE_SERVICE_ROLE_KEY`

3. **JWT signing key (modern asymmetric flow).** The app mints custom JWTs (after validating Telegram `initData`) and the Supabase REST/Realtime API verifies them via the published JWKS endpoint. We use **ES256** asymmetric keys — the modern flow Supabase recommends, and the only flow available on new projects without re-enabling legacy HS256.

   1. **Generate a key pair locally** (the private half stays on your laptop / in Vercel env, never in Supabase):
      ```bash
      pnpm exec supabase gen signing-key --algorithm ES256
      ```
      This prints a single-line JWK JSON object to stdout. Example shape:
      ```json
      {"kty":"EC","kid":"86b038f9-…","use":"sig","key_ops":["sign","verify"],"alg":"ES256","ext":true,"d":"…","crv":"P-256","x":"…","y":"…"}
      ```
      Copy **the entire one-line JSON** as the value of `SUPABASE_JWT_PRIVATE_KEY`. Do not split, do not pretty-print, do not strip fields. The `d` field is the private exponent — treat it as a secret.

   2. **Import the public half into Supabase** (so its API will verify our tokens):
      - Open **Project Settings → JWT Keys** (`/dashboard/project/<ref>/settings/jwt`).
      - Click **"Create new standby key"**.
      - **Important**: the modal opens with the default mode **"Generate a new key"**. *Do not use this mode* — it asks Supabase to generate a brand-new keypair server-side, and the private half never leaves Supabase. That doesn't fit our flow (we need the private key in our env to mint JWTs).
      - Toggle the mode to **"Import an existing key"**. A JSON paste field appears.
      - Paste the **single one-line JWK JSON** from step 1 (same value you saved as `SUPABASE_JWT_PRIVATE_KEY` in `.env.local`).
      - Click **Create**. The key lands as a Standby key.
      - Click **"Rotate keys"** to promote Standby → Active. Supabase keeps the previous Active key in "Previously used" state for ~5 min so any in-flight tokens still verify.
      - If the Standby slot is already occupied (e.g. you accidentally clicked Generate first), use the kebab menu on that row → **"Move to previously used"** before importing the new one.

   3. **Verify the JWKS endpoint** is publishing the new key:
      ```bash
      curl https://<your-project-ref>.supabase.co/auth/v1/.well-known/jwks.json
      ```
      You should see your `kid` in the `keys` array.

4. **DB connection (Session Pooler — IPv4).** Click **Connect** at the top of the project page → copy the **Session pooler** URI.

   Format: `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`. Replace `[YOUR-PASSWORD]` with the database password you set on creation. Save as `SUPABASE_DB_URL`.

   ⚠ Don't use **Direct connection** (`db.<ref>.supabase.co:5432`) for `SUPABASE_DB_URL` — Direct is IPv6-by-default, and **Vercel's build runners are IPv4-only**, so the deploy-time `supabase db push` would fail with `network is unreachable`. The Session Pooler is IPv4-compatible and supports DDL + session-level features that migrations rely on.

   ⚠ Don't use **Transaction Pooler** (port `6543`) either — transaction-mode pooling doesn't support migrations.

   Migrations are applied automatically on every Vercel deploy via `pnpm vercel-build`, which runs `supabase db push --db-url "$SUPABASE_DB_URL" --include-all && next build`. No manual `supabase link` / `supabase db push` is required.

5. (Optional, only if you want to regenerate `src/types/database.ts` from the live schema):
   ```bash
   supabase login
   supabase link --project-ref <ref>
   pnpm db:types
   ```

## 3. Local `.env.local` (already pre-filled)

A `.env.local` file has been generated in the repo root with the auto-generatable values pre-filled. It's gitignored (`.env*.local`) and stays on your machine. You only need to fill in the values that come from external systems.

| Variable | Source | Status |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | BotFather (§1) | **fill in** |
| `TELEGRAM_BOT_USERNAME` | BotFather (§1, no leading `@`) | **fill in** |
| `BOOTSTRAP_ADMIN_TG_USER_IDS` | @userinfobot (§1) — single id or comma-separated (`12345,67890`) | **fill in** |
| `TELEGRAM_WEBHOOK_SECRET` | random hex | ✅ pre-filled |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API page (§2.2) | **fill in** |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase API Keys (§2.2, `sb_publishable_…` or legacy `anon`) | **fill in** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API Keys (§2.2, `sb_secret_…` or legacy `service_role`) | **fill in** |
| `SUPABASE_JWT_PRIVATE_KEY` | `supabase gen signing-key` (§2.3) | ✅ pre-filled — also paste this same value into the Supabase JWT Keys import modal |
| `SUPABASE_DB_URL` | Supabase Connect → **Session pooler** (port 5432, `pooler.supabase.com` host) — see §2.4 for why **not** Direct/Transaction pooler | **fill in** |
| `APP_BASE_URL` | `http://localhost:3000` for local dev | ✅ pre-filled |
| `DAILY_QUOTA_SECONDS`, `CLAIM_TTL_MINUTES`, `DEFAULT_TZ` | defaults | ✅ pre-filled |
| `CRON_SECRET` | random hex | ✅ pre-filled |

> ⚠ The pre-filled secrets (`TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`, `SUPABASE_JWT_PRIVATE_KEY`) **must also be added to Vercel → Project Settings → Environment Variables** with the same values. Same for the values you fill in. Local + Vercel must match.

## 4. Vercel deploy

1. Push the repo to GitHub.
2. Import the repo into Vercel (Framework: Next.js, defaults are fine).
3. Add every variable from `.env.local` to **Vercel → Project Settings → Environment Variables**, set for all environments. Set `APP_BASE_URL` to the production URL Vercel gives you (e.g. `https://hebtutbot.vercel.app`). `SUPABASE_DB_URL` must be set or the build will fail.
4. Deploy. The build runs `supabase db push` against `SUPABASE_DB_URL` before `next build` — migrations land before any request hits the new code. Re-deploys are idempotent (Supabase tracks applied migrations in the `supabase_migrations.schema_migrations` table).
5. Smoke check: `curl https://<your-domain>/api/ping` → `{"ok":true,...}`.

## 5. Schedule the claim-expiry cron via Upstash QStash

Vercel Hobby caps cron at once-per-day, which is too slow for a 15-minute claim TTL. We run the schedule on Upstash QStash instead (free tier — 5-min cadence = 288 msgs/day, well under the 500/day cap).

1. Sign in to [console.upstash.com](https://console.upstash.com) → **QStash**. Free tier, no credit card.
2. **Schedules** → **Create schedule**:
   - **Destination**: `https://<your-vercel-domain>/api/cron/expire-claims`
   - **Method**: `POST`
   - **Cron**: `*/5 * * * *` (every 5 minutes)
   - **Headers** → add one:
     - Name: `Upstash-Forward-Authorization`
     - Value: `Bearer <CRON_SECRET>` (use the exact `CRON_SECRET` value you set in Vercel env)
     - QStash reserves the bare `Authorization` header for its own signature, so you must use the `Upstash-Forward-` prefix. QStash strips that prefix when delivering, so our route still sees a normal `Authorization: Bearer …` header.
   - **Retries**: leave default
3. Save. Within ~5 min the schedule's **Events** tab should show a `200` for the first invocation. A `200` body of `{"released": 0}` means there were no stale claims — that's the expected steady state.

Manual sanity check from your terminal:

```bash
curl -X POST -H "Authorization: Bearer <CRON_SECRET>" \
  https://<your-vercel-domain>/api/cron/expire-claims
# → {"released":0}
```

If you get `403 forbidden`, the bearer doesn't match `CRON_SECRET`.

## 6. Wire the Telegram webhook

After the first successful deploy:

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://<your-vercel-domain>/api/webhook",
    "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
    "allowed_updates": ["message","callback_query"]
  }'
```

Verify:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

`url` should be set, `last_error_message` should be `null`.

## 7. Wire the Mini App

Back in [@BotFather](https://t.me/BotFather):

1. `/mybots` → pick your bot → **Bot Settings** → **Menu Button** → **Edit Menu Button URL**.
2. Set the URL to `https://<your-vercel-domain>/`.
3. Set the button label (e.g. `Открыть приложение`).

(Equivalent CLI flow: `/setmenubutton`.)

## 8. End-to-end smoke test

With three Telegram accounts (or a friend + a second device):

1. Each account sends `/start` to the bot. They receive `Привет! Зарегистрировался…`.
   - The account with `BOOTSTRAP_ADMIN_TG_USER_ID` is auto-promoted to `admin` on first webhook hit.
2. Open the bot in Telegram → tap the menu button → admin dashboard loads.
3. Promote one account to `student`, another to `teacher`. Link them in the **Связи** panel.
4. From the student account, hold the mic and send a voice message ≤ 5 min.
   - Student receives `✅ Отправлено! Осталось …`.
   - Teacher receives `🔔 <name> прислал(а) голосовое 0:XX…`.
5. Open the teacher's Mini App → **Входящие** tab → tap **Ответить**.
   - Mini-app closes, a TG prompt arrives: `📩 Ответь <name> — голосовое 0:XX…`.
6. Swipe-reply to that prompt with a voice message of your own.
   - Student receives the teacher's voice in their bot chat.
   - Teacher receives `✅ Ответ отправлен ученику.`
   - The thread view in the Mini App shows both bubbles.

If any step fails, check Vercel function logs and Supabase tables.

## 9. Optional: reduce CLAIM_TTL for testing the cron

Temporarily set `CLAIM_TTL_MINUTES=1` in Vercel env, redeploy, claim a message, then wait up to `CLAIM_TTL_MINUTES + 5` minutes (1 min for the claim to go stale + up to 5 min for the next QStash tick):

- Prompt edits to `⚠️ Время на ответ истекло…`.
- Other teachers' notifications revert to actionable.
- Inbox entry returns to `pending`.

Or trigger the sweep immediately from the QStash dashboard (**Schedules → … → Run now**) or via curl to skip the wait.

Restore `CLAIM_TTL_MINUTES=15` after.
