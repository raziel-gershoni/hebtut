# Infra Setup Checklist

End-to-end, ~30 min. PoC only — prod = dev = test.

## 1. Telegram bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram.
2. `/newbot` → pick a name and username (e.g. `hebtut_bot`). Save the **token**.
3. Get your own numeric Telegram user id from [@userinfobot](https://t.me/userinfobot). Save it as `BOOTSTRAP_ADMIN_TG_USER_ID`.
4. (Skip the Mini-App URL for now — we'll set it after the Vercel deploy.)

## 2. Supabase project

1. Create a new project at [supabase.com](https://supabase.com) (e.g. `hebtutbot-dev`). Wait ~2 min for it to provision.
2. From **Project Settings → API** copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY`
3. From **Project Settings → API → JWT Settings** copy the **JWT Secret** → `SUPABASE_JWT_SECRET`.
4. From the project page tap **Connect** → **ORMs** (or **Database → Connection string**) → copy the **Direct connection** URI (host `db.<ref>.supabase.co:5432`, NOT the pooler at 6543). Replace `[YOUR-PASSWORD]` with the database password you set on creation. Save as `SUPABASE_DB_URL`.

   Migrations are applied automatically on every Vercel deploy via `pnpm vercel-build`, which runs `supabase db push --db-url "$SUPABASE_DB_URL" --include-all && next build`. No manual `supabase link` / `supabase db push` is required.

5. (Optional, only if you want to regenerate `src/types/database.ts` from the live schema):
   ```bash
   supabase login
   supabase link --project-ref <ref>
   pnpm db:types
   ```

## 3. Local `.env.local`

Copy `.env.example` → `.env.local` and fill in:

```dotenv
TELEGRAM_BOT_TOKEN=<from step 1>
TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 32>
TELEGRAM_BOT_USERNAME=<your bot username, no @>

NEXT_PUBLIC_SUPABASE_URL=<from step 2>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from step 2>
SUPABASE_SERVICE_ROLE_KEY=<from step 2>
SUPABASE_JWT_SECRET=<from step 2>
SUPABASE_DB_URL=<from step 2 — direct, port 5432>

APP_BASE_URL=http://localhost:3000
BOOTSTRAP_ADMIN_TG_USER_ID=<from step 1>
DAILY_QUOTA_SECONDS=300
CLAIM_TTL_MINUTES=15
DEFAULT_TZ=Asia/Jerusalem

CRON_SECRET=<openssl rand -hex 32>
```

## 4. Vercel deploy

1. Push the repo to GitHub.
2. Import the repo into Vercel (Framework: Next.js, defaults are fine).
3. Add every variable from `.env.local` to **Vercel → Project Settings → Environment Variables**, set for all environments. Set `APP_BASE_URL` to the production URL Vercel gives you (e.g. `https://hebtutbot.vercel.app`). `SUPABASE_DB_URL` must be set or the build will fail.
4. Deploy. The build runs `supabase db push` against `SUPABASE_DB_URL` before `next build` — migrations land before any request hits the new code. Re-deploys are idempotent (Supabase tracks applied migrations in the `supabase_migrations.schema_migrations` table).
5. Smoke check: `curl https://<your-domain>/api/ping` → `{"ok":true,...}`.

## 5. Wire the Telegram webhook

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

## 6. Wire the Mini App

Back in [@BotFather](https://t.me/BotFather):

1. `/mybots` → pick your bot → **Bot Settings** → **Menu Button** → **Edit Menu Button URL**.
2. Set the URL to `https://<your-vercel-domain>/`.
3. Set the button label (e.g. `Открыть приложение`).

(Equivalent CLI flow: `/setmenubutton`.)

## 7. End-to-end smoke test

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

## 8. Optional: reduce CLAIM_TTL for testing the cron

Temporarily set `CLAIM_TTL_MINUTES=1` in Vercel env, redeploy, claim a message, wait ~2 min:

- Prompt edits to `⚠️ Время на ответ истекло…`.
- Other teachers' notifications revert to actionable.
- Inbox entry returns to `pending`.

Restore `CLAIM_TTL_MINUTES=15` after.
