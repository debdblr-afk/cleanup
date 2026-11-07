# Cleanup (working name)

Remove your own logos, burned-in captions and stray text from videos you own. This is a clean-room rebuild of the core loop of a video watermark remover. The planning files are in `../replica-watermark/`: recon, architecture, design, build log and `backend.md`.

## Run it locally

Needs Docker running (for the local Supabase stack).

```bash
npm install
npm run db:start          # local Postgres, Auth, Storage, Realtime, Mailpit (ports 553xx)
cp .env.example .env.local  # then fill from: npx supabase status -o env
npm run dev               # or the "cleanup" entry in ../.claude/launch.json (port 5320)
```

- Sign-in emails go to Mailpit: http://127.0.0.1:55324
- Database UI (Studio): http://127.0.0.1:55323

## Tests

```bash
npm test                  # unit: quota, masks, plans, the fill and the detector
npm run test:api          # end to end against the dev server: every route, access rules with two users, Stripe webhooks, crons
```

## How it fits together

- **Reads:** row level security plus Supabase Realtime. **Writes:** `app/api/*`, with ownership, plan limits and daily caps checked on the server.
- **Files:** a private Supabase Storage bucket, reached only through 10-minute signed URLs (`lib/server/storage.ts`, the one file to change for R2).
- **Work queue:** `removal_jobs` and `exports`, claimed with `claim_work()`. For now, the open browser tab is the worker: `lib/engine/` detects, fills, renders and uploads the result. A GPU worker plugs into the same queue later.
- **Payments:** Stripe Checkout, the Customer Portal and the webhook (test mode). Leave `STRIPE_SECRET_KEY` empty and checkout answers "payments aren't set up".
- **Crons** (`vercel.json`): `/api/cron/expire` hourly, `/api/cron/sweep` every 5 minutes, both behind `CRON_SECRET`.
